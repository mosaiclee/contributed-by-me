const SCORE_IMAGE_WIDTH = 3840;
const SCORE_IMAGE_HEIGHT = 2160;
const SCORE_IMAGE_SCALE = 3;

function scoreXml(value) {
  return String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
}

// Snapshot the rendered score geometry. Scrolling cancels out of these relative
// bounds; zoom is deliberately retained. Playback padding and editing controls
// are excluded from the printable extent.
function scorePrintLines(project, renderedRows) {
  const items = [];
  let originX = Infinity, originY = Infinity, right = 0, bottom = 0;
  const add = (node, markup) => {
    const r = node.getBoundingClientRect();
    if (!r.width || !r.height) return;
    items.push({x:r.left, y:r.top, width:r.width, height:r.height, markup});
    originX = Math.min(originX, r.left); originY = Math.min(originY, r.top);
    right = Math.max(right, r.right); bottom = Math.max(bottom, r.bottom);
  };
  const addText = (node, value, reference = node) => {
    const r = reference.getBoundingClientRect(), style = getComputedStyle(node);
    const scale = reference.offsetWidth ? r.width / reference.offsetWidth : 1;
    const size = parseFloat(style.fontSize) * scale;
    const markup = '<text x="0" y="' + (size * .9) + '" font-family="system-ui,sans-serif" font-size="' + size + '" font-weight="' + style.fontWeight + '" fill="#17212c">' + scoreXml(value) + '</text>';
    add(reference, markup);
  };
  for (const track of project.tracks) {
    const {row, entries} = renderedRows.get(track.id);
    const head = row.querySelector('.staff-head');
    // Sticky headers must use their natural row position, not the scrolled position.
    const rowRect = row.getBoundingClientRect(), headRect = head.getBoundingClientRect();
    const title = track.name + '  ' + presetLabelForTrack(track);
    const fontScale = head.offsetHeight ? headRect.height / head.offsetHeight : 1;
    items.push({x:rowRect.left,y:headRect.top,width:Math.max(180,title.length*11)*fontScale,height:headRect.height,
      markup:'<text x="0" y="'+(22*fontScale)+'" font-size="'+(20*fontScale)+'" font-family="system-ui,sans-serif" font-weight="bold">'+scoreXml(title)+'</text>'});
    originX=Math.min(originX,rowRect.left);originY=Math.min(originY,headRect.top);
    right=Math.max(right,rowRect.left+items.at(-1).width);bottom=Math.max(bottom,headRect.bottom);
    for (const entry of entries) {
      const glyph = entry.graphic;
      add(glyph, '<svg width="100%" height="100%" viewBox="'+glyph.getAttribute('viewBox')+'" preserveAspectRatio="none" overflow="visible">'+glyph.innerHTML+'</svg>');
      for (const node of entry.box.querySelectorAll('.group-meter,.group-tempo,.group-meter-change')) {
        addText(node,node.textContent.replace(/\s*▾/g,''));
      }
    }
    for (const boundary of row.querySelectorAll('.barline')) {
      const svg=boundary.querySelector('svg');
      add(svg,'<svg width="100%" height="100%" viewBox="'+svg.getAttribute('viewBox')+'">'+svg.innerHTML+'</svg>');
      const marker=boundary.querySelector('.measure-marker');if(marker)addText(marker,marker.textContent);
    }
  }
  if(!items.length)throw new Error('Empty score');
  const margin=32, titleHeight=70;
  return {items:items.map(item=>({...item,x:item.x-originX+margin,y:item.y-originY+titleHeight})),
    width:Math.ceil(right-originX+margin*2),height:Math.ceil(bottom-originY+titleHeight+margin)};
}

function scoreTilePlan(width,height) {
  const columns=Math.max(1,Math.ceil(width/1280));
  const tileWidth=Math.ceil(width/columns), tileHeight=720;
  const rows=Math.max(1,Math.ceil(height/tileHeight));
  const scale=Math.max(3,3840/Math.max(tileWidth,tileHeight));
  const tiles=[];
  for(let row=0;row<rows;row++)for(let col=0;col<columns;col++)
    tiles.push({x:col*tileWidth,y:row*tileHeight,width:tileWidth,height:tileHeight,row,col,scale});
  return tiles;
}

async function scoreJpegPages(title,bpm,score,shouldContinue) {
  const canvas=document.createElement('canvas'), context=canvas.getContext('2d',{alpha:false}), pages=[];
  if(!context)throw new Error('Canvas unavailable');
  const tiles=scoreTilePlan(score.width,score.height);
  try {
    for(const tile of tiles){
      if(!shouldContinue())return null;
      canvas.width=Math.round(tile.width*tile.scale);canvas.height=Math.round(tile.height*tile.scale);
      const parts=['<svg xmlns="http://www.w3.org/2000/svg" width="'+canvas.width+'" height="'+canvas.height+'" viewBox="'+[tile.x,tile.y,tile.width,tile.height].join(' ')+'" color="#131920">'];
      if(tile.y===0)parts.push('<text x="32" y="30" font-family="system-ui,sans-serif" font-size="24" font-weight="bold">'+scoreXml(title)+'</text><text x="32" y="53" font-family="system-ui,sans-serif" font-size="13">RhythmDesk · '+bpm+' BPM</text>');
      for(const item of score.items){
        if(item.x+item.width+32<tile.x||item.x-32>tile.x+tile.width||item.y+item.height+32<tile.y||item.y-32>tile.y+tile.height)continue;
        parts.push('<svg x="'+item.x+'" y="'+item.y+'" width="'+item.width+'" height="'+item.height+'" overflow="visible">'+item.markup+'</svg>');
      }
      parts.push('</svg>');
      const url=URL.createObjectURL(new Blob(parts,{type:'image/svg+xml;charset=utf-8'})),image=new Image();
      try{
        await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=reject;image.src=url;});
        context.fillStyle='white';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(image,0,0);
        const blob=await new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error('JPEG encoding failed')),'image/jpeg',.98));
        blob.scoreWidth=canvas.width;blob.scoreHeight=canvas.height;
        blob.printWidth=tile.width*.75;blob.printHeight=tile.height*.75;
        blob.tileName='row-'+String(tile.row+1).padStart(2,'0')+'-col-'+String(tile.col+1).padStart(2,'0');
        pages.push(blob);
      }finally{image.removeAttribute('src');URL.revokeObjectURL(url);}
    }
    return pages;
  }finally{canvas.width=canvas.height=1;}
}

function scorePdf(pages) {
  const chunks = [];
  const offsets = [0];
  const encoder = new TextEncoder();
  let length = 0;
  const append = value => {
    const bytes = typeof value === 'string' ? encoder.encode(value) : value;
    chunks.push(bytes);
    length += bytes instanceof Blob ? bytes.size : bytes.byteLength;
  };
  const object = (id, dictionary, stream) => {
    offsets[id] = length;
    append(id + ' 0 obj\n' + dictionary + '\n');
    if (stream) {
      append('stream\n');
      append(stream);
      append('\nendstream\n');
    }
    append('endobj\n');
  };
  const firstPage = 3;
  append('%PDF-1.4\n');
  append(Uint8Array.of(37, 226, 227, 207, 211, 10));
  object(1, '<< /Type /Catalog /Pages 2 0 R >>');
  object(2, '<< /Type /Pages /Count ' + pages.length + ' /Kids [' +
    pages.map((_, index) => (firstPage + index * 3) + ' 0 R').join(' ') + '] >>');
  pages.forEach((image, index) => {
    const id = firstPage + index * 3;
    const imageWidth = image.scoreWidth ?? SCORE_IMAGE_WIDTH;
    const imageHeight = image.scoreHeight ?? SCORE_IMAGE_HEIGHT;
    const pdfWidth = image.printWidth ?? 540 * imageWidth / imageHeight;
    const pdfHeight = image.printHeight ?? 540;
    object(id, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + pdfWidth + ' ' + pdfHeight + '] /Resources << /XObject << /Score ' +
      (id + 1) + ' 0 R >> >> /Contents ' + (id + 2) + ' 0 R >>');
    object(id + 1, '<< /Type /XObject /Subtype /Image /Width ' + imageWidth +
      ' /Height ' + imageHeight + ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + image.size + ' >>', image);
    const paint = 'q\n' + pdfWidth + ' 0 0 ' + pdfHeight + ' 0 0 cm\n/Score Do\nQ\n';
    object(id + 2, '<< /Length ' + paint.length + ' >>', paint);
  });
  const xref = length;
  append('xref\n0 ' + offsets.length + '\n0000000000 65535 f \n' +
    offsets.slice(1).map(offset => String(offset).padStart(10, '0') + ' 00000 n \n').join('') +
    'trailer\n<< /Size ' + offsets.length + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF\n');
  return new Blob(chunks, {type: 'application/pdf'});
}

async function scoreJpegZip(pages) {
  // JPEGs are already compressed. Use ZIP's stored method to avoid extra encoding.
  const crcTable = Uint32Array.from({length: 256}, (_, index) => {
    let value = index;
    for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
    return value;
  });
  const files = [];
  const directory = [];
  const encoder = new TextEncoder();
  let offset = 0;
  let directorySize = 0;
  for (let index = 0; index < pages.length; index++) {
    const page = pages[index];
    const name = encoder.encode('page-' + String(index + 1).padStart(3, '0') + '-' + (page.tileName ?? 'score') + '.jpg');
    let crc = 0xffffffff;
    for (const byte of new Uint8Array(await page.arrayBuffer())) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 255];
    const local = new DataView(new ArrayBuffer(30));
    const central = new DataView(new ArrayBuffer(46));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(12, 33, true); // 1980-01-01, minimum DOS date.
    local.setUint32(14, crc ^ 0xffffffff, true);
    local.setUint32(18, page.size, true);
    local.setUint32(22, page.size, true);
    local.setUint16(26, name.length, true);
    central.setUint32(0, 0x02014b50, true);
    central.setUint16(4, 20, true);
    new Uint8Array(central.buffer).set(new Uint8Array(local.buffer, 4, 26), 6);
    central.setUint32(42, offset, true);
    files.push(local.buffer, name, page);
    directory.push(central.buffer, name);
    offset += local.byteLength + name.length + page.size;
    directorySize += central.byteLength + name.length;
  }
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, pages.length, true);
  end.setUint16(10, pages.length, true);
  end.setUint32(12, directorySize, true);
  end.setUint32(16, offset, true);
  return new Blob([...files, ...directory, end.buffer], {type: 'application/zip'});
}
