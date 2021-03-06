import kmp from 'kmp';
import html2canvas from 'html2canvas';

var captureImage = (type)=>{
  try {
    html2canvas(document.body,{
      height: window.innerHeight,
      width: window.innerWidth,
      allowTaint: false,
      taintTest: true,
      useCORS: false,
      background: '#FFFFFF',
      onrendered: (canvas)=>{
        var quality =  0.2;
        var dataUrl = canvas.toDataURL('image/jpeg', quality);
        console.log('Data url created');
        chrome.runtime.sendMessage(chrome.runtime.id, {type: 'screenshot', image: dataUrl}, (response)=>{});
      }
    }).catch(()=>{
      console.log('Error capturing, using fallback (promise)');
    });
  } catch (e) {
    console.log('Error capturing, using fallback (catch)');
  }
};

var getImageInit = (type)=>{
  chrome.runtime.sendMessage(chrome.runtime.id, {type: 'checkSSCapture'}, (response)=>{
    captureImage(type);
  });
};

var getBlacklist = new Promise((resolve, reject)=>{
  chrome.storage.sync.get('blacklist', (bl)=>{
    if (bl && bl.blacklist) {
      resolve(bl);
    }
  });
});
var getPrefs = new Promise((resolve, reject)=>{
  chrome.runtime.sendMessage(chrome.runtime.id, {method: 'prefs'}, (response)=>{
    if (response && response.prefs) {
      resolve(response.prefs);
    }
  });
});
getPrefs.then((prefs)=>{
  var blacklistPref = prefs.blacklist;
  var screenshotsPref = prefs.screenshot;
  if (screenshotsPref) {
    if (prefs.screenshotInit) {
      getImageInit(false);
    }
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      console.log(msg, sender);
      if (msg.type === 'activate') {
        captureImage(msg.type);
      }
    });
  }
  if (blacklistPref) {
    getBlacklist.then((bl)=>{
      for (var i = 0; i < bl.blacklist.length; i++) {
        if (kmp(window.location.href, bl.blacklist[i]) !== -1) {
          chrome.runtime.sendMessage({method: 'close'}, (response)=>{
          });
        }
      }
    });
  }
});
