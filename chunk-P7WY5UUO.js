import{a as l}from"./chunk-TIT3ERPG.js";import"./chunk-2WH2EVR6.js";var i=class extends l{decodeBlock(s){let o=new DataView(s),r=[];for(let e=0;e<s.byteLength;++e){let t=o.getInt8(e);if(t<0){let n=o.getUint8(e+1);t=-t;for(let a=0;a<=t;++a)r.push(n);e+=1}else{for(let n=0;n<=t;++n)r.push(o.getUint8(e+n+1));e+=t+1}}return new Uint8Array(r).buffer}};export{i as default};
