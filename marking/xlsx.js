"use strict";
/* Builds a small .xlsx (Excel) file in the browser. No outside libraries. */
window.MDXlsx = (function(){
  const enc = new TextEncoder();
  const CRC = (()=>{ const t=new Uint32Array(256); for(let n=0;n<256;n++){ let c=n; for(let k=0;k<8;k++) c=c&1?0xEDB88320^(c>>>1):c>>>1; t[n]=c>>>0; } return t; })();
  const crc32 = b => { let c=0xFFFFFFFF; for(let i=0;i<b.length;i++) c=CRC[(c^b[i])&255]^(c>>>8); return (c^0xFFFFFFFF)>>>0; };
  const esc = s => String(s).replace(/[^\x09\x0A\x0D\x20-퟿-�\u{10000}-\u{10FFFF}]/gu,'')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  const col = i => { let s=''; for(i++; i>0; i=Math.floor((i-1)/26)) s=String.fromCharCode(65+(i-1)%26)+s; return s; };
  function zip(files){
    const d=new Date(), time=(d.getHours()<<11)|(d.getMinutes()<<5)|(d.getSeconds()>>1), date=((d.getFullYear()-1980)<<9)|((d.getMonth()+1)<<5)|d.getDate();
    const parts=[], central=[]; let off=0;
    for(const [name,text] of files){
      const nb=enc.encode(name), data=enc.encode(text), crc=crc32(data);
      const h=new DataView(new ArrayBuffer(30));
      h.setUint32(0,0x04034b50,true); h.setUint16(4,20,true); h.setUint16(10,time,true); h.setUint16(12,date,true);
      h.setUint32(14,crc,true); h.setUint32(18,data.length,true); h.setUint32(22,data.length,true); h.setUint16(26,nb.length,true);
      const c=new DataView(new ArrayBuffer(46));
      c.setUint32(0,0x02014b50,true); c.setUint16(4,20,true); c.setUint16(6,20,true); c.setUint16(12,time,true); c.setUint16(14,date,true);
      c.setUint32(16,crc,true); c.setUint32(20,data.length,true); c.setUint32(24,data.length,true); c.setUint16(28,nb.length,true); c.setUint32(42,off,true);
      parts.push(new Uint8Array(h.buffer),nb,data); central.push(new Uint8Array(c.buffer),nb);
      off+=30+nb.length+data.length;
    }
    const csize=central.reduce((a,b)=>a+b.length,0), e=new DataView(new ArrayBuffer(22));
    e.setUint32(0,0x06054b50,true); e.setUint16(8,files.length,true); e.setUint16(10,files.length,true); e.setUint32(12,csize,true); e.setUint32(16,off,true);
    return new Blob([...parts,...central,new Uint8Array(e.buffer)],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
  }
  function build(head, rows, sheetName){
    const widths=[];
    const rowXml=(n,cells,style)=>{ let x='<row r="'+n+'">';
      cells.forEach((v,i)=>{ widths[i]=Math.max(widths[i]||0,String(v??'').length); if(v===''||v==null) return;
        const ref=col(i)+n;
        x+= typeof v==='number'&&isFinite(v) ? '<c r="'+ref+'" s="'+style+'"><v>'+v+'</v></c>'
          : '<c r="'+ref+'" s="'+style+'" t="inlineStr"><is><t xml:space="preserve">'+esc(v)+'</t></is></c>'; });
      return x+'</row>'; };
    let data=rowXml(1,head,1); rows.forEach((r,i)=>{ data+=rowXml(i+2,r,0); });
    const cols=head.map((_,i)=>'<col min="'+(i+1)+'" max="'+(i+1)+'" width="'+Math.min(40,Math.max(6,(widths[i]||8)+2))+'" customWidth="1"/>').join('');
    const X='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>', NS='http://schemas.openxmlformats.org/spreadsheetml/2006/main',
          R='http://schemas.openxmlformats.org/officeDocument/2006/relationships', P='http://schemas.openxmlformats.org/package/2006';
    return zip([
      ['[Content_Types].xml',X+'<Types xmlns="'+P+'/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>'],
      ['_rels/.rels',X+'<Relationships xmlns="'+P+'/relationships"><Relationship Id="rId1" Type="'+R+'/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
      ['xl/workbook.xml',X+'<workbook xmlns="'+NS+'" xmlns:r="'+R+'"><sheets><sheet name="'+esc(sheetName||'Results')+'" sheetId="1" r:id="rId1"/></sheets></workbook>'],
      ['xl/_rels/workbook.xml.rels',X+'<Relationships xmlns="'+P+'/relationships"><Relationship Id="rId1" Type="'+R+'/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="'+R+'/styles" Target="styles.xml"/></Relationships>'],
      ['xl/styles.xml',X+'<styleSheet xmlns="'+NS+'"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE4EAFB"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>'],
      ['xl/worksheets/sheet1.xml',X+'<worksheet xmlns="'+NS+'"><sheetViews><sheetView workbookViewId="0"><pane xSplit="1" ySplit="1" topLeftCell="B2" activePane="bottomRight" state="frozen"/></sheetView></sheetViews><cols>'+cols+'</cols><sheetData>'+data+'</sheetData></worksheet>']
    ]);
  }
  return {build};
})();
