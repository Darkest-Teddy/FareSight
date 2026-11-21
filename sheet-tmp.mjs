import { Jimp } from 'jimp';
const cands = ['relax_inn_seaview_suite','lebombo','kiara_interior','solitude_interior','cabin','veranda','en_suite','country_club','fireplace','lapa','wooden_lounge','hotel_room'];
const W=400,H=200,COLS=3;
const sheet = new Jimp({width:W*COLS, height:H*Math.ceil(cands.length/COLS), color:0x000000ff});
for(let i=0;i<cands.length;i++){
  const url=`https://cdn.polyhaven.com/asset_img/thumbs/${cands[i]}.png?width=400&height=200`;
  try{
    const r=await fetch(url,{headers:{'User-Agent':'FareSight/1.0'}});
    if(!r.ok){console.log('miss',cands[i],r.status);continue;}
    const img=await Jimp.read(Buffer.from(await r.arrayBuffer()));
    img.resize({w:W,h:H});
    sheet.composite(img,(i%COLS)*W,Math.floor(i/COLS)*H);
    console.log(i,cands[i]);
  }catch(e){console.log('err',cands[i],e.message);}
}
await sheet.write('./sheet-tmp.png');
console.log('order:',cands.join(', '));
