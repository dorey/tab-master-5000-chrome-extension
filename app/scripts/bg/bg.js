window._trackJs = {
  token: 'bd495185bd7643e3bc43fa62a30cec92',
  enabled: false,
  onError: function (payload) { 
    console.log('payload', payload)
    if (payload.message.indexOf('unknown') !== -1) {
      return false;
    }
    return true; 
  },
  version: "",
  callback: {
    enabled: true,
    bindStack: true
  },
  console: {
    enabled: true,
    display: true,
    error: true,
    warn: false,
    watch: ['log', 'info', 'warn', 'error']
  },
  network: {
    enabled: true,
    error: true
  },
  visitor: {
    enabled: true
  },
  window: {
    enabled: true,
    promise: true
  }
};
var trackJs = require('trackjs');
import React from 'react';
import ReactDOM from 'react-dom';
import Reflux from 'reflux';
import _ from 'lodash';
import v from 'vquery';
import uuid from 'node-uuid';
import prefsStore from '../components/stores/prefs';

const eventState = {
  onStartup: null,
  onUpdateAvailable: null,
  onInstalled: null,
  onUninstalled: null,
  onEnabled: null,
  onDisabled: null
};
chrome.runtime.onStartup.addListener(()=>{
  eventState.onStartup = {type: 'startup'};
});
chrome.runtime.onUpdateAvailable.addListener((details)=>{
  eventState.onUpdateAvailable = details;
});
chrome.runtime.onInstalled.addListener((details)=>{
  eventState.onInstalled = details;
});

var checkChromeErrors = (err)=>{
  if (chrome.runtime.lastError) {
    window.trackJs.track(chrome.runtime.lastError);
  }
  if (chrome.extension.lastError) {
    window.trackJs.track(chrome.extension.lastError);
  }
  if (err) {
    window.trackJs.track(err);
  }
};

var checkChromeErrorsThrottled = _.throttle(checkChromeErrors, 2000, {leading: true});

var sendMsg = (msg, res) => {
  chrome.runtime.sendMessage(chrome.runtime.id, msg, (response)=>{
    if (response) {
      res(response);
    }
  });
};

var reload = (reason)=>{
  // console log messages before error triggered location.reload() calls. Preserve console logging in the browser to see them.
  console.log('Reload background script. Reason: ',reason);
  setTimeout(()=>{
    location.reload();
  },0);
};

var syncSession = (sessions, prefs, windows=null, cb)=>{
  var allTabs = [];
  if (typeof prefs.syncedSession !== 'undefined' && prefs.syncedSession && prefs.sessionsSync) {
    var refSession = _.findIndex(sessions, {id: prefs.syncedSession});
    if (refSession === -1) {
      return;
    }
    for (let i = 0, len = windows.length; i < len; i++) {
      allTabs.push(windows[i].tabs);
      for (let z = 0, _len = windows[i].tabs.length; z < _len; z++) {
        if (windows[i].tabs[z].url === 'chrome://newtab/') {
          _.pullAt(windows[i].tabs, z);
        }
      }
    }
    sessions[refSession].tabs = allTabs;
    sessions[refSession].timeStamp = new Date(Date.now());
    sessions[refSession] = sessions[refSession];
    chrome.storage.local.set({sessions: sessions});
  }
};

var checkAutoDiscard = (windows, prefs)=>{
  var discards = 0;
  if (prefs.autoDiscard) {
    for (let i = 0, len = windows.length; i < len; i++) {
      for (let z = 0, _len = windows[i].tabs.length; z < _len; z++) {
        if (windows[i].tabs[z].hasOwnProperty('timeStamp') && windows[i].tabs[z].timeStamp + prefs.autoDiscardTime < Date.now()) {
          ++discards;
          chrome.tabs.discard(windows[i].tabs[z].id);
          console.log('Discarding: ', windows[i].tabs[z].title);
        }
      }
    }
  }
  return discards;
};

var createScreenshot = (t, refWindow, refTab, run=0)=>{
  if (refWindow === -1 || refTab === -1) {
    return;
  }
  if (t.state.windows[refWindow].tabs[refTab] === undefined) {
    return;
  }
  if (t.state.windows[refWindow].tabs[refTab].url.indexOf('chrome://newtab/') !== -1) {
    return;
  }
  if (t.state.screenshots === undefined) {
    t.state.screenshots = [];
  }
  var capture = new Promise((resolve, reject)=>{
    try {
      _.delay(()=>{
        chrome.tabs.captureVisibleTab({format: 'jpeg', quality: 10}, (image)=> {
          if (image) {
            resolve(image);
          } else {
            ++run;
            if (run <= 1) {
              _.delay(()=>createScreenshot(t, refWindow, refTab, run), 500);
            } else {
              reject(null);
            }
          }
        });
      }, 500);
    } catch (e) {
      reject(e);
    }
  });
  capture.then((image)=>{
    var resize = new Promise((resolve, reject)=>{
      var sourceImage = new Image();
      sourceImage.onload = function() {
        var imgWidth = sourceImage.width / 2;
        var imgHeight = sourceImage.height / 2;
        var canvas = document.createElement('canvas');
        canvas.width = imgWidth;
        canvas.height = imgHeight;
        canvas.getContext('2d').drawImage(sourceImage, 0, 0, imgWidth, imgHeight);
        var newDataUri = canvas.toDataURL('image/jpeg', 0.25);
        if (newDataUri) {
          resolve(newDataUri);
        }
      };
      sourceImage.src = image;
    });
    resize.then((image)=>{
      if (typeof t.state.windows[refWindow].tabs[refTab] === 'undefined') {
        return;
      }
      var screenshot = {
        url: t.state.windows[refWindow].tabs[refTab].url, 
        data: image, 
        timeStamp: Date.now()
      };
      
      var refScreenshot = _.findIndex(t.state.screenshots, {url: t.state.windows[refWindow].tabs[refTab].url});
      if (refScreenshot !== -1) {
        t.state.screenshots[refScreenshot] = screenshot;
      } else {
        t.state.screenshots.push(screenshot);
      }

      chrome.storage.local.set({screenshots: t.state.screenshots}, ()=>{
      });
      t.setState({screenshots: t.state.screenshots}, ()=>{
        sendMsg({screenshots: t.state.screenshots});
      });
    });
  }).catch((e)=>{
    return;
  });
};

var createScreenshotThrottled = _.throttle(createScreenshot, 2000, {leading: true});

var synchronizeSession = _.throttle(syncSession, 100, {leading: true});

var setAction = (t, type, oldTabInstance, newTabInstance=null)=>{
  if (t.state.prefs && !t.state.prefs.actions) {
    return;
  }
  if (t.state.actions.length > 30) {
    var firstAction = _.findIndex(t.state.actions, {id: _.first(t.state.actions).id});
    if (firstAction !== -1) {
      _.pullAt(t.state.actions, firstAction);
    }
  }
  if (newTabInstance && newTabInstance.title !== 'New Tab' || oldTabInstance && oldTabInstance.title !== 'New Tab') {
    var action = {
      type: type, 
      item: _.cloneDeep(type === 'update' ? newTabInstance : oldTabInstance),
      id: uuid.v4()
    };
    if (type === 'update' && oldTabInstance !== undefined) {
      if (oldTabInstance.mutedInfo.muted !== newTabInstance.mutedInfo.muted) {
        action.type = newTabInstance.mutedInfo.muted ? 'mute' : 'unmute';
      } else if (oldTabInstance.pinned !== newTabInstance.pinned) {
        action.type = newTabInstance.pinned ? 'pin' : 'unpin';
      } else {
        return;
      }
    }
    t.state.actions.push(action);
    t.setState({actions: t.state.actions});
    var msgToSend = {};
    if (oldTabInstance !== undefined) {
      msgToSend.windowId = oldTabInstance.windowId;
    }
    msgToSend.actions = t.state.actions;
    sendMsg(msgToSend);
  }
};

var setActionThrottled = _.throttle(setAction, 100, {leading: true});

var Bg = React.createClass({
  mixins: [Reflux.ListenerMixin],
  getInitialState(){
    return {
      eventState: eventState,
      prefs: null,
      init: true,
      windows: [],
      newTabs: [],
      sessions: [],
      screenshots: [],
      actions: [],
      chromeVersion: parseInt(/Chrome\/([0-9.]+)/.exec(navigator.userAgent)[1].split('.'))
    };
  },
  componentDidMount(){
    this.listenTo(prefsStore, this.prefsChange);
    this.querySessions();
  },
  prefsChange(e){
    var s = this.state;
    console.log('prefsChange');
    s.prefs = e;
    this.setState({prefs: s.prefs});
    if (s.init) {
      this.attachListeners(s);
      this.queryTabs(null, s.prefs);
      if (s.prefs.screenshot) {
        this.queryScreenshots();
      }
    } else {
      sendMsg({e: e, type: 'prefs'});
    }
  },
  attachListeners(state){
    var s = this.state.init ? state : this.state;
    /*
    App state
    */
    if (eventState.onStartup) {
      _.defer(()=>{
        sendMsg({e: eventState.onStartup, type: 'startup'});
      });
    }
    if (eventState.onInstalled) {
      if (eventState.onInstalled.reason === 'update' || eventState.onInstalled.reason === 'install') {
        var newTabIsOpen = false;
        chrome.tabs.query({title: 'New Tab'},(tabs)=>{
          for (let i = 0, len = tabs.length; i < len; i++) {
            newTabIsOpen = true;
            chrome.tabs.remove(tabs[i].id);
          }
        });
        chrome.tabs.query({active: true},(tabs)=>{
          for (let i = 0, len = tabs.length; i < len; i++) {
            if (tabs[i].active) {
              setTimeout(()=>{
                if (!newTabIsOpen) {
                  return;
                }
                chrome.tabs.create({active: false}, (tab)=>{
                  setTimeout(()=>{
                    if (eventState.onInstalled.reason === 'install') {
                      sendMsg({e: eventState.onInstalled, type:'appState', action: 'installed'});
                    } else if (eventState.onInstalled.reason === 'update') {
                      sendMsg({e: eventState.onInstalled, type:'appState', action: 'versionUpdate'});
                    }
                  }, 1000);
                  chrome.tabs.update(tabs[i].id, {active: true});
                });
              },500);
              break;
            }
          }
        });
      }
    }
    if (eventState.onUpdateAvailable) {
      sendMsg({e: eventState.onUpdateAvailable, type:'appState', action: 'newVersion'});
    }
    /*
    Storage changed
    */
    chrome.storage.onChanged.addListener((changed, areaName)=>{
      console.log('Storage changed: ', changed, areaName);
      if (changed.hasOwnProperty('sessions') && areaName === 'local') {
        this.setState({sessions: changed.sessions.newValue});
        if (this.state.prefs && this.state.prefs.screenshot) {
          sendMsg({sessions: changed.sessions.newValue});
        }
      } else if (changed.hasOwnProperty('screenshots') && areaName === 'local' && this.state.prefs && this.state.prefs.screenshot) {
        this.setState({screenshots: changed.screenshots.newValue});
        sendMsg({screenshots: changed.screenshots.newValue});
      }
    });
    /*
    Windows created
    */
    chrome.windows.onCreated.addListener((Window)=>{
      chrome.tabs.query({windowId: Window.id}, (tabs)=>{
        _.assignIn(Window, {
          tabs: tabs
        });
        this.state.windows.push(Window);
        this.setState({windows: this.state.windows});
        sendMsg({windows: this.state.windows, windowId: Window.id});
      });
    });
    /* 
    Windows removed 
    */
    chrome.windows.onRemoved.addListener((windowId)=>{
      var refWindow = _.findIndex(this.state.windows, {windowId: windowId});
      if (refWindow !== -1) {
        _.pullAt(this.state.windows, refWindow);
        this.setState({windows: this.state.windows});
        sendMsg({windows: this.state.windows});
      }
    });
    /*
    Tabs created
    */
    chrome.tabs.onCreated.addListener((e, info) => {
      eventState.onCreated = e;
      this.createSingleItem(e);
    });
    /*
    Tabs removed
    */
    chrome.tabs.onRemoved.addListener((e, info) => {
      eventState.onRemoved = e;
      this.removeSingleItem(e, info.windowId);
    });
    /*
    Tabs activated
    */
    chrome.tabs.onActivated.addListener((e, info) => {
      eventState.onActivated = e;
      this.handleActivation(e);
    });
    /*
    Tabs updated
    */
    chrome.tabs.onUpdated.addListener((e, info) => {
      eventState.onUpdated = e;
      this.updateSingleItem(e);
    });
    /*
    Tabs moved
    */
    chrome.tabs.onMoved.addListener((e, info) => {
      eventState.onMoved = e;
      this.moveSingleItem(e);
    });
    /*
    Tabs attached
    */
    chrome.tabs.onAttached.addListener((e, info) => {
      eventState.onAttached = e;
      this.createSingleItem(e);
    });
    /*
    Tabs detached
    */
    chrome.tabs.onDetached.addListener((e, info) => {
      eventState.onDetached = e;
      this.removeSingleItem(e, info.windowId);
    });
    /*
    Bookmarks created
    */
    chrome.bookmarks.onCreated.addListener((e, info) => {
      eventState.bookmarksOnCreated = e;
      sendMsg({e: e, type: 'bookmarks'});
    });
    /*
    Bookmarks removed
    */
    chrome.bookmarks.onRemoved.addListener((e, info) => {
      eventState.bookmarksOnRemoved = e;
      sendMsg({e: e, type: 'bookmarks'});
    });
    /*
    Bookmarks changed
    */
    chrome.bookmarks.onChanged.addListener((e, info) => {
      eventState.bookmarksOnChanged= e;;
      sendMsg({e: e, type: 'bookmarks'});
    });
    /*
    Bookmarks moved
    */
    chrome.bookmarks.onMoved.addListener((e, info) => {
      eventState.bookmarksOnMoved= e;
      sendMsg({e: e, type: 'bookmarks'});
    });
    /*
    History visited
    */
    chrome.history.onVisited.addListener((e, info) => {
      eventState.historyOnVisited = e;
      sendMsg({e: e, type: 'history', action: 'visited'});
    });
    /*
    History removed
    */
    chrome.history.onVisitRemoved.addListener((e, info) => {
      eventState.historyOnVisitRemoved = e;
      sendMsg({e: e, type: 'history', action: 'remove'});
    });
    /*
    App/ext enabled
    */
    chrome.management.onEnabled.addListener((details)=>{
      eventState.onEnabled = details;
      sendMsg({e: details, type: 'app'});
    });
    this.attachMessageListener(s);
    this.setState({init: false});
  },
  attachMessageListener(s){
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      console.log('Message from front-end: ', msg, sender);
      // requests from front-end javascripts
      if (msg.method === 'captureTabs') {
        var capture = new Promise((resolve, reject)=>{
          try {
            chrome.tabs.captureVisibleTab({format: 'jpeg', quality: 10}, (image)=> {
              if (image) {
                resolve(image);
              } else {
                reject();
              }
              checkChromeErrorsThrottled();
            });
          } catch (e) {
            console.log(e);
            reject();
          }
        });
        capture.then((image)=>{
          sendResponse({'image': image});
        }).catch((e)=>{
          if (s.prefs.mode !== 'tabs') {
            chrome.tabs.update(msg.id, {active: true});
          } else {
            sendMsg({e: sender.id, type: 'error'});
          }
        });
      } else if (msg.method === 'close') {
        chrome.tabs.remove(sender.tab.id);
      } else if (msg.method === 'restoreWindow') {
        for (let i = 0, len = msg.tabs.length; i < len; i++) {
          chrome.tabs.create({
            windowId: msg.windowId,
            index: msg.tabs[i].index,
            url: msg.tabs[i].url,
            active: msg.tabs[i].active,
            selected: msg.tabs[i].selected,
            pinned: msg.tabs[i].pinned
          }, (t)=>{
            console.log('restored: ',t);
            checkChromeErrorsThrottled();
          });
        }
        sendResponse({'reload': true});
      } else if (msg.method === 'prefs') {
        sendResponse({'prefs': s.prefs});
      } else if (msg.method === 'setPrefs') {
        prefsStore.set_prefs(msg.obj);
        sendResponse({'prefs': prefsStore.get_prefs()});
      } else if (msg.method === 'getTabs') {
        sendResponse({windows: this.state.windows, windowId: sender.tab.windowId});
      } else if (msg.method === 'queryTabs') {
        this.queryTabs(true, this.state.prefs);
      } else if (msg.method === 'getSessions') {
        sendResponse({sessions: this.state.sessions});
      } else if (msg.method === 'getScreenshots') {
        sendResponse({screenshots: this.state.screenshots});
      } else if (msg.method === 'removeSingleWindow') {
        this.removeSingleWindow(msg.windowId);
      } else if (msg.method === 'undoAction') {
        var refWindow = _.findIndex(this.state.windows, {id: msg.windowId});
        this.undoAction(this.state.windows[refWindow].tabs, this.state.chromeVersion);
      } else if (msg.method === 'getActions') {
        sendResponse({actions: this.state.actions});
      }
      return true;
    });
  },
  formatTabs(prefs, tabs){
    var blacklisted = [];
    for (let i = 0, len = tabs.length; i < len; i++) {
      var urlMatch = tabs[i].url.match(/^(?:https?:\/\/)?(?:[^@\n]+@)?(?:www\.)?([^:\/\n]+)/im);
      _.assign(tabs[i], {
        timeStamp: new Date(Date.now()).getTime(),
        domain: urlMatch ? urlMatch[1] : tabs[i].url.split('/')[2]
      });
      if (tabs[i].url.indexOf('chrome://newtab/') !== -1) {
        blacklisted.push({id: tabs[i].id, windowId: tabs[i].windowId});
      }
    }
    if (blacklisted.length > 0 && prefs && prefs.singleNewTab) {
      var extraNewTabs = _.tail(blacklisted);
      console.log(extraNewTabs, blacklisted);
      for (let i = 0, len = extraNewTabs.length; i < len; i++) {
        chrome.tabs.remove(extraNewTabs[i].id);
      }
      this.state.newTabs.push(blacklisted[0]);
    } else {
      this.state.newTabs = _.concat(this.state.newTabs, blacklisted);
    }
    this.setState({newTabs: _.uniqBy(this.state.newTabs, 'id')});
    return tabs;
  },
  queryTabs(send=null, prefs){
    chrome.windows.getAll({populate: true}, (w)=>{
      for (let i = 0, len = w.length; i < len; i++) {
        w[i].tabs = this.formatTabs(prefs, w[i].tabs);
      }
      this.setState({windows: w});
      if (send) {
        sendMsg({windows: this.state.windows});
      }
    });
  },
  convertV1Sessions(_item){
    for (let i = 0, len = _item.sessionData.length; i < len; i++) {
      var session = {
        timeStamp: _item.sessionData[i].timeStamp, 
        tabs: [_item.sessionData[i].tabs], 
        label: _item.sessionData[i].label, 
        id: uuid.v4()
      };
      _item.sessionData[i] = session;
    }
    return _item;
  },
  querySessions(){
    chrome.storage.local.get('sessions',(item)=>{
      var sessions = [];
      console.log('item retrieved: ',item);
      if (item && item.sessions) {
        // Sort sessionData array to show the newest sessions at the top of the list.
        //var reverse = _.orderBy(item.sessions, ['timeStamp'], ['desc']);
        sessions = item.sessions;
      } else {
        chrome.storage.local.get('sessionData',(_item)=>{
          console.log('sessions v1 fall back: ',_item);
          if (_item && _item.sessionData) {
            // Backwards compatibility for sessions v1
            _item = this.convertV1Sessions();
            chrome.storage.local.set({sessions: _item.sessionData});
          } else {
            sessions = [];
          }
        });
      }
      sessions = _.orderBy(sessions, ['timeStamp'], ['desc']);
      this.setState({sessions: sessions});
      sendMsg({sessions: sessions});
    });
  },
  queryScreenshots(){
    var save = (index)=>{
      chrome.storage.local.set({screenshots: index}, (result)=> {

      });
    };
    chrome.storage.local.get('screenshots', (shots)=>{
      var index = [];
      if (shots && shots.screenshots) {
        index = shots.screenshots;
      } else {
        save([]);
      }
      this.setState({screenshots: index});
    });
  },
  keepNewTabOpen() {
    // Work around to prevent losing focus of New Tab page when a tab is closed or pinned from the grid.
    chrome.tabs.query({
      title: 'New Tab',
      active: true
    }, function(Tab) {
      for (let i = 0, len = Tab.length; i < len; i++) {
        chrome.tabs.update(Tab[i].id, {
          active: true
        });
      }
    });
  },
  undoAction(tabs, chromeVersion){
    var removeLastAction = (lastAction)=>{
      if (lastAction !== undefined) {
        var refAction = _.findIndex(this.state.actions, {id: lastAction.id});
        if (refAction !== -1) {
          _.pullAt(this.state.actions, refAction);
        }
      }
    };
    var undo = ()=>{
      var lastAction = _.last(this.state.actions);
      if (lastAction) {
        if (lastAction.type === 'remove') {
          this.keepNewTabOpen();

          chrome.tabs.create({url: lastAction.item.url, index: lastAction.item.index}, (t)=>{
            console.log('Tab created from tabStore.createTab: ',t);
          });
        } else if (lastAction.type === 'update') {
          this.state.actions = _.without(this.state.actions, _.last(this.state.actions));
          undo();
        } else if (lastAction.type.indexOf('mut') !== -1 && chromeVersion >= 46) {
          chrome.tabs.update(lastAction.item.id, {muted: !lastAction.item.mutedInfo.muted});
        } else if (lastAction.type.indexOf('pin') !== -1) {
          chrome.tabs.update(lastAction.item.id, {pinned: !lastAction.item.pinned});
        } else if (lastAction.type === 'create') {
          chrome.tabs.remove(lastAction.item.id);
        } else if (lastAction.type === 'move') {
          chrome.tabs.move(lastAction.item.id, {index: lastAction.item.index});
        } else {
          removeLastAction(lastAction);
        }
      }
      removeLastAction(lastAction);
      this.setState({actions: this.state.actions});
      sendMsg({actions: this.state.actions, windowId: tabs[0].windowId});
    };
    undo();
  },
  getSingleTab(id){
    if (_.isObject(id)) {
      id = id.tabId;
    }
    return new Promise((resolve, reject)=>{
      chrome.tabs.get(id, (tab)=>{
        if (chrome.runtime.lastError) {
          reject();
        }
        if (tab) {
          resolve(tab);
        } else {
          reject();
        }
      });
    });
  },
  handleActivation(e){
    var refWindow = _.findIndex(this.state.windows, {id: e.windowId});
    if (refWindow === -1) {
      return;
    }
    var refTab = _.findIndex(this.state.windows[refWindow].tabs, {id: e.tabId});
    if (refTab === -1) {
      return;
    }
    if (this.state.windows[refWindow].tabs[refTab].url.indexOf('chrome://newtab/') !== -1) {
      return;
    }
    // Update timestamp for auto-discard feature's accuracy.
    _.merge(this.state.windows[refWindow].tabs[refTab], {
      timeStamp: new Date(Date.now()).getTime()
    });

    this.setState({windows: this.state.windows});
    if (this.state.prefs && this.state.prefs.screenshot && this.state.prefs.screenshotChrome) {
      createScreenshotThrottled(this, refWindow, refTab);
    }
  },
  createSingleItem(e){
    var refWindow = _.findIndex(this.state.windows, {id: e.windowId});
    if (refWindow === -1) {
      return;
    }

    if (typeof this.state.windows[refWindow].tabs[e.index] !== 'undefined') {
      for (let i = 0, len = this.state.windows[refWindow].tabs.length; i < len; i++) {
        if (i > e.index) {
          if (i <= this.state.windows[refWindow].tabs.length) {
            this.state.windows[refWindow].tabs[i].index = i + 1;
          }
        }
      }
      this.state.windows[refWindow].tabs.push(e);
      this.state.windows[refWindow].tabs = v(this.state.windows[refWindow].tabs).move(_.findIndex(this.state.windows[refWindow].tabs, _.last(this.state.windows[refWindow].tabs)), e.index).ns;  
    } else {
      this.state.windows[refWindow].tabs.push(e);
    }
    this.state.windows[refWindow].tabs = _.orderBy(_.uniqBy(this.state.windows[refWindow].tabs, 'id'), ['pinned'], ['desc']);
    this.state.windows[refWindow].tabs = this.formatTabs(this.state.prefs, this.state.windows[refWindow].tabs);
    this.setState({windows: this.state.windows});
    // Activate the first new tab if it is open, and if this is a second new tab being created.
    if (e.url.indexOf('chrome://newtab/') !== -1 && this.state.prefs.singleNewTab) {
      var refNewTab = _.findIndex(this.state.newTabs, {windowId: e.windowId});
      if (refNewTab !== -1) {
        var refExistingTab = _.findIndex(this.state.windows[refWindow].tabs, {id: this.state.newTabs[refNewTab].id});
        if (refExistingTab === -1 || this.state.windows[refWindow].tabs[refExistingTab].url.indexOf('chrome://newtab/') === -1) {
          _.pullAt(this.state.newTabs, refNewTab);
          this.setState({newTabs: this.state.newTabs}, ()=>{
            chrome.tabs.create({active: true});
          });
        } else {
          chrome.tabs.update(this.state.newTabs[refNewTab].id, {active: true}, ()=>{
            sendMsg({focusSearchEntry: true});
          });
        }
        return;
      }
    }
    setActionThrottled(this, 'create', e);
    synchronizeSession(this.state.sessions, this.state.prefs, this.state.windows);
    sendMsg({windows: this.state.windows, windowId: e.windowId});
  },
  removeSingleItem(e, windowId){
    var refWindow = _.findIndex(this.state.windows, {id: windowId});
    if (refWindow === -1) {
      return;
    }
    // Check if this is a new tab, and clean up newTabs state.
    var refNewTab = _.findIndex(this.state.newTabs, {id: e});
    if (refNewTab !== -1) {
      _.pullAt(this.state.newTabs, refNewTab);
      this.setState({newTabs: this.state.newTabs});
    }

    var refTab = _.findIndex(this.state.windows[refWindow].tabs, {id: e});
    if (refTab > -1) {
      setActionThrottled(this, 'remove', this.state.windows[refWindow].tabs[refTab]);
      _.pullAt(this.state.windows[refWindow].tabs, refTab);

      this.state.windows[refWindow].tabs = _.orderBy(_.uniqBy(this.state.windows[refWindow].tabs, 'id'), ['pinned'], ['desc']);
      this.setState({windows: this.state.windows, newTabs: this.state.newTabs});
      synchronizeSession(this.state.sessions, this.state.prefs, this.state.windows);
      sendMsg({windows: this.state.windows, windowId: windowId});
    }
  },
  removeSingleWindow(id){
    console.log('removeSingleWindow', id);
    var refWindow = _.findIndex(this.state.windows, {id: id});
    if (refWindow !== -1) {
      _.pullAt(this.state.windows, refWindow);
      this.setState({windows: this.state.windows});
      sendMsg({windows: this.state.windows});
    }
  },
  updateSingleItem(id){
    this.getSingleTab(id).then((e)=>{
      var refWindow = _.findIndex(this.state.windows, {id: e.windowId});
      if (refWindow === -1) {
        return;
      }
      var refTab = _.findIndex(this.state.windows[refWindow].tabs, {id: e.id});
      if (refTab === -1) {
        return;
      }
      setActionThrottled(this, 'update', this.state.windows[refWindow].tabs[refTab], e);
      _.merge(e, {
        timeStamp: new Date(Date.now()).getTime()
      });

      if (refTab > -1) {
        this.state.windows[refWindow].tabs[refTab] = e;
        if (e.pinned) {
          this.state.windows[refWindow].tabs = _.orderBy(_.uniqBy(this.state.windows[refWindow].tabs, 'id'), ['pinned'], ['desc']);
        } else {
          this.state.windows[refWindow].tabs = _.orderBy(this.state.windows[refWindow].tabs, ['pinned'], ['desc']);
        }
        this.setState({windows: this.state.windows});
        synchronizeSession(this.state.sessions, this.state.prefs, this.state.windows);
        var discards = checkAutoDiscard(this.state.windows, this.state.prefs);
        if (discards > 0) {
          this.queryTabs(true, this.state.prefs);
        } else {
          sendMsg({windows: this.state.windows, windowId: e.windowId});
        }
      }
    });
  },
  moveSingleItem(id){
    this.getSingleTab(id).then((e)=>{
      var refWindow = _.findIndex(this.state.windows, {id: e.windowId});
      if (refWindow === -1) {
        return;
      }
      var refTab = _.findIndex(this.state.windows[refWindow].tabs, {id: e.id});
      setActionThrottled(this, 'move', this.state.windows[refWindow].tabs[refTab], e);
      if (refTab > -1) {
        this.state.windows[refWindow].tabs = v(this.state.windows[refWindow].tabs).move(refTab, e.index).ns;
        this.state.windows[refWindow].tabs[refTab].timeStamp = new Date(Date.now()).getTime();
        if (e.pinned) {
          this.state.windows[refWindow].tabs = _.orderBy(_.uniqBy(this.state.windows[refWindow].tabs, 'id'), ['pinned'], ['desc']);
        } else {
          this.state.windows[refWindow].tabs = _.orderBy(this.state.windows[refWindow].tabs, ['pinned'], ['desc']);
        }
        this.setState({windows: this.state.windows});
        synchronizeSession(this.state.sessions, this.state.prefs, this.state.windows);
        sendMsg({windows: this.state.windows, windowId: e.windowId});   
      }
    });
  },
  render(){
    console.log('BG STATE: ',this.state);
    return null;
  }
});
ReactDOM.render(<Bg />, document.body);