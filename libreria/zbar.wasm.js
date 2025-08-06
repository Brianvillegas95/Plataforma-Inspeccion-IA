var ZBar = (function() {
 var _scriptDir = typeof document !== 'undefined' && document.currentScript ? document.currentScript.src : undefined;
 return (
  function(ZBar) {
   ZBar = ZBar || {};

var Module=ZBar;Module.ready.then(function(a){Module.zbar=a});
return ZBar;
  }
 );
})();
if (typeof exports === 'object' && typeof module === 'object')
 module.exports = ZBar;
else if (typeof define === 'function' && define['amd'])
 define([], function() { return ZBar; });
else if (typeof exports === 'object')
 exports["ZBar"] = ZBar;