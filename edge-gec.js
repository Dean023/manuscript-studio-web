// Edge Read Aloud v2 token algorithm, adapted from rany2/edge-tts (LGPL-3.0).
// The endpoint is unofficial and may change without notice.
const K=[
  0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
  0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
  0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
  0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
  0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
  0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
  0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
  0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2
];
const IV=[0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
const SEED=[0xfd9fbea2,0x91243ce7,0xbe499094,0xcd2e1e0a,0x6c006f49,0x04bd35ab,0xfeb0a7e4,0x03effbd2];
const SCHEDULE=[0xeb24bf9e,0x1558691f,0xa0c09ee2,0x0cfa32ba,0xa622ee8c,0xd1dd9491,0xc0dd25a0,0xf9e70ab6,0xf0c31573,0x7058ce4e,0x7188e606,0x00e5ab33,0xd258b060,0x72766564];
const COEFF=[
  [0xe82e91b1,0xb32700d0],[0x44de24c6,0x88dff51d],[0x3beb65bc,0x29514038],[0xc89c5933,0xb328cbdf],
  [0x8d1ec211,0xd405b4d5],[0x314ef5d5,0x26e55f3c],[0xe92491b1,0x607801c6],[0xf0a5b9d5,0x82b2c1fb],
  [0x06064cf3,0xfa51a3da],[0xda79fa60,0x207cc464],[0xbed20560,0x3c3c74f3],[0x89f9c9f8,0xd2d14b61],
  [0x35fa38c6,0xbb04a2c1],[0xcb49e3c6,0xc5626167]
];
const rotr=(x,n)=>(x>>>n)|(x<<(32-n));
const rol16=x=>((x<<16)|(x>>>16))>>>0;
const s0=x=>(rotr(x,7)^rotr(x,18)^(x>>>3))>>>0;
const s1=x=>(rotr(x,17)^rotr(x,19)^(x>>>10))>>>0;
const S0=x=>(rotr(x,2)^rotr(x,13)^rotr(x,22))>>>0;
const S1=x=>(rotr(x,6)^rotr(x,11)^rotr(x,25))>>>0;
function expand(words,from=16){
  for(let i=from;i<64;i++)words.push((s1(words[i-2])+words[i-7]+s0(words[i-15])+words[i-16])>>>0);
}
function rounds(state,words,first=0,constants=K){
  let [a,b,c,d,e,f,g,h]=state;
  for(let i=first;i<64;i++){
    const t1=(h+S1(e)+(g^(e&(f^g)))+constants[i]+words[i])>>>0;
    const t2=(S0(a)+((a&b)|(c&(a|b))))>>>0;
    [a,b,c,d,e,f,g,h]=[(t1+t2)>>>0,a,b,c,(d+t1)>>>0,e,f,g];
  }
  return [a,b,c,d,e,f,g,h];
}
function initSha(first7){
  const words=Array(14).fill(0);
  words.push(((first7[0]<<16)|(first7[1]<<8)|first7[2])>>>0);
  words.push(new DataView(first7.buffer,first7.byteOffset+3,4).getUint32(0,false));
  for(let i=16;i<30;i++){
    let v=SCHEDULE[i-16];
    if(i-2>=14)v+=(i===16?s1(words[i-2])^0x000b92c0:s1(words[i-2]));
    if(i-7>=14)v+=words[i-7];
    if(i-15>=14)v+=(i===29?s0(words[i-15])^0x059c0b80:s0(words[i-15]));
    words.push(v>>>0);
  }
  words.push((s1(words[28])+words[23]+s0(words[15])+words[14]+0xc9dc06a7-K[14])>>>0);
  expand(words,31);
  const special=K.slice();special[14]=0xc9dc06a7;
  const work=rounds(SEED,words,14,special);
  return IV.map((x,i)=>(x+work[i])>>>0);
}
function tokenSha(data){
  const length=57+data.length,tail=data.slice(7),zeroCount=((55-length)%64+64)%64;
  const padded=new Uint8Array(tail.length+1+zeroCount+8);
  padded.set(tail);padded[tail.length]=0x80;
  new DataView(padded.buffer).setBigUint64(padded.length-8,BigInt(length)*8n,false);
  let state=initSha(data.slice(0,7));
  for(let offset=0;offset<padded.length;offset+=64){
    const view=new DataView(padded.buffer,offset,64),words=[];
    for(let i=0;i<16;i++)words.push(view.getUint32(i*4,false));
    expand(words);const work=rounds(state,words);
    state=state.map((x,i)=>(x+work[i])>>>0);
  }
  const out=new Uint8Array(32),view=new DataView(out.buffer);
  state.forEach((x,i)=>view.setUint32(i*4,x,false));
  return out;
}
function cs64(data,digest){
  const view=new DataView(digest.buffer,digest.byteOffset,digest.byteLength),keyA=view.getUint32(0,true)|1,keyB=view.getUint32(4,true)|1;
  const factors=[Math.imul(keyA,0x82893933),Math.imul(keyB,0x82893933)];
  const terms=COEFF.map((pair,i)=>Math.imul(pair[0],factors[i%2])>>>0),offsets=COEFF.map(pair=>pair[1]);
  const input=new Uint8Array(data.length+1);input.set(data,1);
  const count=Math.ceil(input.length/4);
  for(let i=0;i<count+(count%2);i++){
    const word=(input[i*4]||0)|((input[i*4+1]||0)<<8)|((input[i*4+2]||0)<<16)|((input[i*4+3]||0)<<24);
    const a=i%2===0;
    let term=Math.imul(word,a?keyA:keyB),off=Math.imul(rol16(word),a?0xef0569fb:0xc31713db);
    if(i===0){term+=Math.imul(0xf2f90b1a,factors[0]);off+=0x0b1a0000;}
    terms.push(term>>>0);offsets.push(off>>>0);
  }
  let swapAcc=0,swapLast=0,state=0,acc=0;
  for(let i=0;i<terms.length;i+=2){
    let t=rol16((offsets[i]+terms[i])>>>0),q=Math.imul(t,0x76f50f34);
    swapAcc=(swapAcc+Math.imul(rol16(q),0xc3efea97)+q)>>>0;
    t=rol16((offsets[i+1]+terms[i+1])>>>0);q=Math.imul(t,0x1881ce3c);
    swapLast=(Math.imul(rol16(q),0x35bd1ec9)+q)>>>0;
    swapAcc=(swapAcc+swapLast)>>>0;
    state=(Math.imul(state,keyA)+terms[i])>>>0;
    state=Math.imul(rol16(state),0xcf98b111);
    state=Math.imul(rol16(state),0x87085b9f);
    state=Math.imul(rol16(state),0x12ceb96d);
    state=Math.imul(rol16(state),0x257e1d83)>>>0;
    acc=(acc+state)>>>0;
    t=(Math.imul(state,keyB)+terms[i+1])>>>0;
    t=Math.imul(rol16(t),0xa27416f5);
    t=Math.imul(rol16(t),0xd38396ff);
    state=Math.imul(rol16(Math.imul(rol16(t),0x7c932b89)),0xbfa49f69)>>>0;
    acc=(acc+state)>>>0;
  }
  const out=new Uint8Array(8),result=new DataView(out.buffer);
  result.setUint32(0,(swapLast^state)>>>0,true);
  result.setUint32(4,(swapAcc^acc)>>>0,true);
  return out;
}
const hexUpper=bytes=>Array.from(bytes,x=>x.toString(16).padStart(2,'0')).join('').toUpperCase();
function gecV2(unixTimestamp=Date.now()/1000){
  let ticks=unixTimestamp+11644473600;ticks-=ticks%300;ticks*=1e7;
  const data=new TextEncoder().encode(ticks.toFixed(0)+'6A5AA1D4EAFF4E9FB37E23D68491D6F4');
  const digest=tokenSha(data);
  return hexUpper(cs64(data,digest))+'-'+hexUpper(digest);
}
export {gecV2};
