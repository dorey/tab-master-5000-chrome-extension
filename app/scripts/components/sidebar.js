import React from 'react';
import _ from 'lodash';

import ReactTooltip from 'react-tooltip';
import state from './stores/state';
import themeStore from './stores/theme';
import tc from 'tinycolor2';
import {utilityStore, msgStore} from './stores/main';
import * as utils from './stores/tileUtils';

import {Btn} from './bootstrap';

var LargeBtn = React.createClass({
  render(){
    var p = this.props;
    return (
      <button 
      style={p.style} 
      className="btn btn-block btn-float btn-float-lg legitRipple" 
      type="button"
      onClick={p.onClick}
      onMouseEnter={p.onMouseEnter}
      onMouseLeave={p.onMouseLeave}>
        <i className={p.icon} /> 
        <span>{p.label}</span>
      </button>
    );
  }
});

export var SidebarMenu = React.createClass({
  getInitialState(){
    return {
      sidebarTab: 'Navigation',
      lgBtnHover: '',
      viewMode: true,
      sortBy: true
    };
  },
  handleFormat(){
    var p = this.props;
    var prefsUpdate = {format: p.prefs.format === 'tile' ? 'table' : 'tile'};
    state.set({prefs: _.assignIn(p.prefs, prefsUpdate)});
    _.defer(()=>msgStore.setPrefs(prefsUpdate));
    ReactTooltip.hide();
  },
  render(){
    var p = this.props;
    var s = this.state;

    var lgBtnOptions = [
      [
        [
          {label: utils.t('tabs'), icon: 'icon-browser', key: 'tabs'},
          p.sessionsExist ? {label: utils.t('sessions'), icon: 'icon-windows2', key: 'sessions'} : {label: utils.t('bookmarks'), icon: 'icon-bookmark4', key: 'bookmarks'},
        ],
        [
          {label: utils.t('history'), icon: 'icon-history', key: 'history'},
          p.sessionsExist ? {label: utils.t('bookmarks'), icon: 'icon-bookmark4', key: 'bookmarks'} : {label: utils.t('apps'), icon: 'icon-grid-alt', key: 'apps'},
        ],
      ],
      [
        [
          p.sessionsExist ? {label: utils.t('apps'), icon: 'icon-grid-alt', key: 'apps'} : {label: utils.t('extensions'), icon: 'icon-puzzle', key: 'extensions'},
        ],
        [
          p.sessionsExist ? {label: utils.t('extensions'), icon: 'icon-puzzle', key: 'extensions'} : null,
        ]
      ]
    ];
    var sidebarTabs = [
      {label: utils.t('settings'), icon: 'icon-gear', onClick: ()=>state.set({modal: {state: true, type: 'settings'}, settings: 'preferences'})},
      {label: utils.t('sessionManager'), icon: 'icon-versions', onClick: ()=>state.set({modal: {state: true, type: 'settings'}, settings: 'sessions'})},
      {label: utils.t('theming'), icon: 'icon-paint-format', onClick: ()=>state.set({modal: {state: true, type: 'settings'}, settings: 'theming'})},
      {label: `${p.prefs.format === 'tile' ? utils.t('table') : utils.t('tile')} ${utils.t('format')}`, icon: `icon-${p.prefs.format === 'tile' ? 'list' : 'grid'}`, onClick: ()=>this.handleFormat()}
    ];
    var borderColor = tc(p.theme.darkBtnBg).isDark() ? p.theme.darkBtnText : p.theme.darkBtnBg;
    var textColor = tc(p.theme.bodyBg).isDark() && tc(p.theme.bodyText).isLight() ? p.theme.bodyText : tc(p.theme.headerBg).isDark() ? p.theme.darkBtnText : p.theme.lightBtnText;
    var lightBtnIsDark = tc(p.theme.lightBtnBg).isDark();
    return (
      <div className="sidebar sidebar-secondary sidebar-default" style={{
        color: textColor
      }}>
        <div className="sidebar-content">
          <div className="tabbable sortable ui-sortable">
            <ul className="nav nav-lg nav-tabs nav-justified">
              {sidebarTabs.map((tab, i)=>{
                var tabStyle = {
                  color: lightBtnIsDark ? p.theme.lightBtnText : p.theme.darkBtnText,
                  backgroundColor: lightBtnIsDark ? p.theme.lightBtnBg : p.theme.darkBtnBg,
                  borderBottom: '0px',
                  cursor: 'pointer'
                };
                return (
                  <li key={i}>
                    <a style={tabStyle} className="legitRipple" onClick={tab.onClick} data-tip={tab.label}>
                      <i className={tab.icon}/>
                    </a>
                  </li>
                );
              })}
            </ul>

            <div className="tab-content">
              <div className="tab-pane no-padding active" id="components-tab">
                <div className="sidebar-category">
                  <div className={`category-title ${p.prefs.showViewMode ? '' : 'category-collapsed'}`} style={{
                    borderTopColor: borderColor,
                    borderTop: `1px solid ${borderColor}`,
                    borderBottomColor: borderColor, 
                    cursor: 'pointer'
                  }} 
                    onClick={()=>msgStore.setPrefs({showViewMode: !p.prefs.showViewMode})}>
                    <span>{utils.t('viewMode')}</span>
                    <ul className="icons-list">
                      <li>
                        <a data-action="collapse" className={p.prefs.showViewMode ? '' : 'rotate-180'}></a>
                      </li>
                    </ul>
                  </div>

                  {p.prefs.showViewMode ?
                  <div className="category-content" style={{height: p.prefs.showViewMode ? 'initial' : '0px', WebkitTransition: 'height 0.2s'}}>
                    <div className="row" onMouseLeave={()=>this.setState({lgBtnHover: ''})}>
                      {lgBtnOptions.map((row, i)=>{
                        return (
                          <div key={i} className="row">
                            {row.map((column, c)=>{
                              return (
                                <div key={c} className="col-xs-6">
                                  {column.map((option, o)=>{
                                    if (option) {
                                      var lgBtnStyle = {
                                        color: p.prefs.mode === option.label.toLowerCase() ? p.theme.lightBtnText : p.theme.darkBtnText,
                                        backgroundColor: p.prefs.mode === option.label.toLowerCase() ? themeStore.opacify(p.theme.lightBtnBg, 0.8) : s.lgBtnHover === option.label ? p.theme.darkBtnBgHover : themeStore.opacify(p.theme.darkBtnBg, 0.8),
                                        marginBottom: '10px'
                                      };
                                      return (
                                        <LargeBtn 
                                        key={o}
                                        style={lgBtnStyle}
                                        icon={option.icon} 
                                        label={option.label}
                                        onClick={()=>utilityStore.handleMode(option.key, p.allTabs)}
                                        onMouseEnter={()=>this.setState({lgBtnHover: option.label})}
                                         />
                                      );
                                    } else {
                                      return null;
                                    }
                                  })}
                                </div>
                              );
                            })}
                          </div>
                        );
                      })}
                    </div>
                  </div> : null}
                </div>
                <div className="sidebar-category">
                  <div 
                  className={`category-title ${p.prefs.sort ? '' : 'category-collapsed'}`} 
                  style={{borderBottomColor: borderColor, cursor: 'pointer'}} 
                  onClick={()=>msgStore.setPrefs({sort: !p.prefs.sort})}>
                    <span>{utils.t('sortBy')}</span>
                    <ul className="icons-list">
                      <li>
                        <a data-action="collapse" className={p.prefs.sort ? '' : 'rotate-180'}></a>
                      </li>
                    </ul>
                  </div>

                  {p.prefs.sort ?
                  <div className="category-content" style={{display: 'block'}}>
                    <form action="#">
                        <div className="form-group">
                          {p.keys.map((key, i)=>{
                            return (
                              <div key={i} className="radio">
                                <label>
                                  <div className="choice">
                                    <span className={p.sort === key ? 'checked' : ''} style={{border: `2px solid ${textColor}`}}>
                                      <input 
                                      type="radio" 
                                      name="radio-group" 
                                      className="styled"
                                      onClick={()=>state.set({sort: key, direction: p.direction === 'desc' ? 'asc' : 'desc'})}
                                       />
                                    </span>
                                  </div>
                                  {p.labels[key]}
                                </label>
                              </div>
                            );
                          })}
                        </div>
                    </form>
                  </div> : null}
                  {p.sort !== 'index' && p.prefs.mode === 'tabs' ?
                  <div style={{textAlign: 'center'}}>
                    <Btn className="ntg-top-btn"  onClick={()=>state.set({applyTabOrder: true})}>{utils.t('apply')}</Btn> 
                  </div> : null}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    ); 
  }
});