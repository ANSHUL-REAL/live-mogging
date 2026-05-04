/* ═══════════════════════════════════════════════
   LIVE MOGGING — app.js
   · Particle hero canvas
   · face-api.js AI mog score
   · Face tracker overlay
   · WebRTC + Socket.IO room
═══════════════════════════════════════════════ */
const socket = io();

/* ── DOM ─────────────────────────────────── */
const $ = id => document.getElementById(id);
const joinScreen   = $('joinScreen'),   roomScreen  = $('roomScreen');
const joinForm     = $('joinForm'),     createRoomBtn=$('createRoomBtn');
const nameInput    = $('nameInput'),    roomInput   = $('roomInput');
const joinError    = $('joinError'),    copyRoomBtn = $('copyRoomBtn');
const connStatus   = $('connStatus'),   leaveBtn    = $('leaveBtn');
const localVideo   = $('localVideo'),   leftVideo   = $('leftVideo'),    rightVideo  = $('rightVideo');
const leftName     = $('leftName'),     rightName   = $('rightName');
const leftVotes    = $('leftVotes'),    rightVotes  = $('rightVotes');
const leftVotePct  = $('leftVotePct'),  rightVotePct= $('rightVotePct');
const leftFill     = $('leftFill'),     rightFill   = $('rightFill');
const voteLeftBtn  = $('voteLeftBtn'),  voteRightBtn= $('voteRightBtn');
const nextRoundBtn = $('nextRoundBtn'), scoreboard  = $('scoreboard'), userList = $('userList');
const toast        = $('toast'),        resultOverlay=$('resultOverlay');
const resultTitle  = $('resultTitle'),  resultDesc  = $('resultDesc'), resultClose=$('resultClose');
const leftCard     = $('leftCard'),     rightCard   = $('rightCard');
const leftRing     = $('leftRing'),     rightRing   = $('rightRing');
const leftBadge    = $('leftBadge'),    rightBadge  = $('rightBadge');
const leftAiNum    = $('leftAiNum'),    rightAiNum  = $('rightAiNum');
const leftAiBar    = $('leftAiBar'),    rightAiBar  = $('rightAiBar');
const leftAiStatus = $('leftAiStatus'), rightAiStatus=$('rightAiStatus');
const leftTracker  = $('leftTracker'),  rightTracker= $('rightTracker');

/* ── State ───────────────────────────────── */
const peers = new Map(), remoteStreams = new Map();
let localStream=null, selfId=null, currentRoomId=null, hasVoted=false;
let activePair={left:null,right:null};
let toastTimer=null;
const ema={left:null,right:null};
const lastLandmarks={left:null,right:null}; // for face mesh overlay

const rtcConfig={iceServers:[
  {urls:'stun:stun.l.google.com:19302'},
  {urls:'stun:stun1.l.google.com:19302'},
  {urls:'turn:openrelay.metered.ca:80',    username:'openrelayproject', credential:'openrelayproject'},
  {urls:'turn:openrelay.metered.ca:443',   username:'openrelayproject', credential:'openrelayproject'},
  {urls:'turn:openrelay.metered.ca:443?transport=tcp', username:'openrelayproject', credential:'openrelayproject'}
]};

/* ══════════════════════════════════════════
   FACE LANDMARK MESH (dots + lines like image)
══════════════════════════════════════════ */
function drawLandmarkMesh(ctx,lm,vid,cvs,color){
  const pts=lm.positions;
  if(!pts||!pts.length)return;
  const vw=vid.videoWidth||640,vh=vid.videoHeight||480;
  const cw=cvs.width,ch=cvs.height;
  const vr=vw/vh,cr=cw/ch;
  let sc,ox=0,oy=0;
  if(vr>cr){sc=ch/vh;ox=(cw-vw*sc)/2;}else{sc=cw/vw;oy=(ch-vh*sc)/2;}
  const T=p=>({x:p.x*sc+ox,y:p.y*sc+oy});
  const tp=pts.map(T);
  const rgba=(a)=>color.replace('rgb(','rgba(').replace(')',','+a+')');
  // Draw mesh lines
  const paths=[
    [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16],
    [17,18,19,20,21],[22,23,24,25,26],
    [27,28,29,30],[31,32,33,34,35],
    [36,37,38,39,40,41,36],[42,43,44,45,46,47,42],
    [48,49,50,51,52,53,54,55,56,57,58,59,48],
    [60,61,62,63,64,65,66,67,60],
    [19,27],[24,27],[21,22],[0,36],[16,45],
    [33,51],[8,57],[36,48],[45,54],[17,0],[26,16]
  ];
  ctx.strokeStyle=rgba(0.45);ctx.lineWidth=0.8;
  ctx.shadowColor=color;ctx.shadowBlur=3;
  paths.forEach(g=>{
    ctx.beginPath();
    g.forEach((i,j)=>j===0?ctx.moveTo(tp[i].x,tp[i].y):ctx.lineTo(tp[i].x,tp[i].y));
    ctx.stroke();
  });
  // Key landmark dots (large + glowing)
  const key=[0,4,8,12,16,17,21,22,26,27,30,33,36,39,42,45,48,51,54,57,62,66];
  ctx.fillStyle=color;ctx.shadowBlur=10;ctx.shadowColor=color;
  key.forEach(i=>{
    if(!tp[i])return;
    ctx.beginPath();ctx.arc(tp[i].x,tp[i].y,3.2,0,Math.PI*2);ctx.fill();
  });
  // All other dots (small)
  ctx.fillStyle=rgba(0.55);ctx.shadowBlur=4;
  pts.forEach((_,i)=>{
    if(key.includes(i)||!tp[i])return;
    ctx.beginPath();ctx.arc(tp[i].x,tp[i].y,1.6,0,Math.PI*2);ctx.fill();
  });
  ctx.shadowBlur=0;
}

/* ══════════════════════════════════════════
   LETTER GLITCH (loading overlay background)
══════════════════════════════════════════ */
function initGlitchCanvas(canvas){
  const ctx=canvas.getContext('2d');
  const chars='.,:;-*#~+=';
  const colors=['#78b4ff','#a0c4ff','#c7d2fe','#e0e7ff','#4a80ff'];
  const fw=10,fh=20,fs=16;
  let letters=[],cols,rows,animId,last=0;
  function rc(){return chars[Math.floor(Math.random()*chars.length)];}
  function rk(){return colors[Math.floor(Math.random()*colors.length)];}
  function build(){
    const p=canvas.parentElement.getBoundingClientRect();
    canvas.width=p.width;canvas.height=p.height;
    cols=Math.ceil(p.width/fw);rows=Math.ceil(p.height/fh);
    letters=Array.from({length:cols*rows},()=>({c:rc(),k:rk()}));
  }
  function draw(){
    ctx.clearRect(0,0,canvas.width,canvas.height);
    ctx.font=fs+'px monospace';ctx.textBaseline='top';
    letters.forEach((l,i)=>{ctx.fillStyle=l.k;ctx.fillText(l.c,(i%cols)*fw,Math.floor(i/cols)*fh);});
  }
  function frame(t){
    animId=requestAnimationFrame(frame);
    if(t-last>55){
      const n=Math.max(1,Math.floor(letters.length*.05));
      for(let i=0;i<n;i++){const x=Math.floor(Math.random()*letters.length);letters[x].c=rc();letters[x].k=rk();}
      draw();last=t;
    }
  }
  build();
  window.addEventListener('resize',()=>{build();draw();});
  requestAnimationFrame(frame);
  return()=>cancelAnimationFrame(animId);
}

/* ══════════════════════════════════════════
   LOADING OVERLAY
══════════════════════════════════════════ */
const loadingOverlay=$('loadingOverlay');
const loadingStage=$('loadingStage');
const asciiBar=$('asciiBar');
const asciiPct=$('asciiPct');
const STAGES=['Requesting camera access…','Connecting to server…','Joining room…','Loading AI face models…','Establishing video…','Ready to Mog!'];
const TOTAL=20;
let glitchStop=null,loadTimer=null,loadPct=0;

function setLoadPct(pct){
  loadPct=pct;
  const filled=Math.round((pct/100)*TOTAL);
  asciiBar.textContent='▓'.repeat(filled)+'░'.repeat(TOTAL-filled);
  asciiPct.textContent=Math.round(pct)+'%';
  const si=Math.min(STAGES.length-1,Math.floor((pct/100)*STAGES.length));
  loadingStage.textContent=STAGES[si];
}

function showLoading(){
  loadingOverlay.classList.remove('hidden');
  setLoadPct(0);
  const gc=$('glitchCanvas');
  if(gc&&!glitchStop)glitchStop=initGlitchCanvas(gc);
  // Animate 0→85% over 2s
  let p=0;
  clearInterval(loadTimer);
  loadTimer=setInterval(()=>{
    p+=1.5+Math.random()*1.5;
    if(p>=85){p=85;clearInterval(loadTimer);}
    setLoadPct(p);
  },50);
}

function hideLoading(){
  clearInterval(loadTimer);
  setLoadPct(100);
  setTimeout(()=>{
    loadingOverlay.classList.add('hidden');
    if(glitchStop){glitchStop();glitchStop=null;}
  },400);
}

/* ══════════════════════════════════════════
   HERO PARTICLE CANVAS
══════════════════════════════════════════ */
(function heroCanvas(){
  const canvas=$('heroCanvas');
  if(!canvas)return;
  const ctx=canvas.getContext('2d');
  let pts=[],animId;
  const mouse={x:null,y:null,r:150};

  class P{
    constructor(){
      this.x=Math.random()*canvas.width;
      this.y=Math.random()*canvas.height;
      this.dx=(Math.random()-.5)*.35;
      this.dy=(Math.random()-.5)*.35;
      this.s=Math.random()*1.8+.6;
      this.a=Math.random()*.45+.25;
    }
    draw(){
      ctx.beginPath();ctx.arc(this.x,this.y,this.s,0,Math.PI*2);
      ctx.fillStyle=`rgba(185,120,255,${this.a})`;ctx.fill();
    }
    update(){
      if(mouse.x!=null){
        const dx=this.x-mouse.x,dy=this.y-mouse.y,d=Math.hypot(dx,dy);
        if(d<mouse.r){const f=(mouse.r-d)/mouse.r;this.x+=dx/d*f*3.5;this.y+=dy/d*f*3.5;}
      }
      this.x+=this.dx;this.y+=this.dy;
      if(this.x<0||this.x>canvas.width)this.dx*=-1;
      if(this.y<0||this.y>canvas.height)this.dy*=-1;
      this.draw();
    }
  }

  function build(){pts=[];const n=Math.floor(canvas.width*canvas.height/8500);for(let i=0;i<n;i++)pts.push(new P());}

  function connect(){
    const md=(canvas.width/7)*(canvas.height/7);
    for(let a=0;a<pts.length;a++)for(let b=a+1;b<pts.length;b++){
      const dx=pts[a].x-pts[b].x,dy=pts[a].y-pts[b].y,d2=dx*dx+dy*dy;
      if(d2<md){
        const op=1-d2/md;
        const near=mouse.x!=null&&Math.hypot(pts[a].x-mouse.x,pts[a].y-mouse.y)<mouse.r;
        ctx.strokeStyle=near?`rgba(255,255,255,${op*.55})`:`rgba(170,110,255,${op*.3})`;
        ctx.lineWidth=.7;ctx.beginPath();ctx.moveTo(pts[a].x,pts[a].y);ctx.lineTo(pts[b].x,pts[b].y);ctx.stroke();
      }
    }
  }

  function frame(){animId=requestAnimationFrame(frame);ctx.clearRect(0,0,canvas.width,canvas.height);pts.forEach(p=>p.update());connect();}

  function resize(){canvas.width=innerWidth;canvas.height=innerHeight;build();}
  window.addEventListener('resize',resize);
  window.addEventListener('mousemove',e=>{mouse.x=e.clientX;mouse.y=e.clientY;});
  window.addEventListener('mouseleave',()=>{mouse.x=null;mouse.y=null;});
  resize();frame();

  document.addEventListener('roomEntered',()=>{cancelAnimationFrame(animId);window.removeEventListener('resize',resize);});
})();

/* ══════════════════════════════════════════
   FACE TRACKER OVERLAY (scan lines + brackets)
══════════════════════════════════════════ */
const trackers=new Map();
function startTracker(vid,cvs,color,side){
  if(trackers.has(vid))return;
  const ctx=cvs.getContext('2d');
  let scan=0,dir=1,animId;
  function draw(){
    const rect=cvs.getBoundingClientRect();
    const w=rect.width, h=rect.height;
    if(!w||!h){trackers.get(vid).animId=requestAnimationFrame(draw);return;}
    cvs.width=Math.round(w);cvs.height=Math.round(h);
    ctx.clearRect(0,0,cvs.width,cvs.height);
    const bx=cvs.width*.18,by=cvs.height*.1,bw=cvs.width*.64,bh=cvs.height*.72,arm=Math.min(cvs.width,cvs.height)*.09;
    ctx.strokeStyle=color;ctx.lineWidth=2.2;ctx.shadowColor=color;ctx.shadowBlur=10;
    // corners
    [[bx,by,1,1],[bx+bw,by,-1,1],[bx,by+bh,1,-1],[bx+bw,by+bh,-1,-1]].forEach(([cx,cy,sx,sy])=>{
      ctx.beginPath();ctx.moveTo(cx,cy+arm*sy);ctx.lineTo(cx,cy);ctx.lineTo(cx+arm*sx,cy);ctx.stroke();
    });
    // scan line
    scan+=dir*1.4;if(scan>bh||scan<0)dir*=-1;
    const sy=by+scan;
    const g=ctx.createLinearGradient(bx,0,bx+bw,0);
    g.addColorStop(0,'transparent');g.addColorStop(.3,color.replace('rgb','rgba').replace(')',',0.75)'));
    g.addColorStop(.5,color.replace('rgb','rgba').replace(')',',1)'));
    g.addColorStop(.7,color.replace('rgb','rgba').replace(')',',0.75)'));
    g.addColorStop(1,'transparent');
    ctx.strokeStyle=g;ctx.lineWidth=1.4;ctx.shadowBlur=14;
    ctx.beginPath();ctx.moveTo(bx,sy);ctx.lineTo(bx+bw,sy);ctx.stroke();
    // grid dots
    ctx.shadowBlur=0;ctx.fillStyle=color.replace('rgb','rgba').replace(')',',0.18)');
    for(let r=0;r<=5;r++)for(let c=0;c<=4;c++){
      ctx.beginPath();ctx.arc(bx+(bw/4)*c,by+(bh/5)*r,1.3,0,Math.PI*2);ctx.fill();
    }
    // Draw face landmark mesh if available
    const lm=side?lastLandmarks[side]:null;
    if(lm)drawLandmarkMesh(ctx,lm,vid,cvs,color);
    trackers.get(vid).animId=requestAnimationFrame(draw);
  }
  animId=requestAnimationFrame(draw);
  trackers.set(vid,{cvs,animId});
}
function stopTracker(vid){
  const t=trackers.get(vid);if(!t)return;
  cancelAnimationFrame(t.animId);
  t.cvs.getContext('2d').clearRect(0,0,t.cvs.width,t.cvs.height);
  trackers.delete(vid);
}

/* ══════════════════════════════════════════
   AI MOG SCORE (face-api.js)
══════════════════════════════════════════ */
const MODEL_URL='https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.14/model/';
let faceApiReady=false;

async function loadFaceApi(){
  try{
    await faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL);
    await faceapi.nets.faceLandmark68TinyNet.loadFromUri(MODEL_URL);
    faceApiReady=true;
    console.log('✅ face-api models loaded');
  }catch(e){console.warn('face-api load failed',e);}
}
loadFaceApi();

function computeScore(landmarks){
  const pts=landmarks.positions;
  const xs=pts.map(p=>p.x),ys=pts.map(p=>p.y);
  const faceW=Math.max(...xs)-Math.min(...xs);
  const faceH=Math.max(...ys)-Math.min(...ys);
  if(faceW<10||faceH<10)return null;

  const cx=(pts[27].x+pts[30].x)/2;

  // 1. Symmetry — compare mirrored landmark distances from center
  const pairs=[[0,16],[1,15],[2,14],[3,13],[4,12],[17,26],[18,25],[19,24],[20,23],[21,22],[36,45],[37,44],[38,43],[39,42],[31,35],[32,34],[48,54],[49,53],[50,52]];
  let asymSum=0;
  pairs.forEach(([l,r])=>{ asymSum+=Math.abs(Math.abs(pts[l].x-cx)-Math.abs(pts[r].x-cx))/faceW; });
  const sym=Math.max(0,1-(asymSum/pairs.length)*9);

  // 2. Facial thirds (brow to nose / nose to chin)
  const t1=Math.abs(pts[19].y-pts[33].y);
  const t2=Math.abs(pts[33].y-pts[8].y);
  const prop=t1>0?Math.max(0,1-Math.abs(t2/t1-1.05)*1.3):0.5;

  // 3. Eye width ratio to face width
  const lew=Math.abs(pts[36].x-pts[39].x),rew=Math.abs(pts[42].x-pts[45].x);
  const eyeR=((lew+rew)/2)/faceW;
  const eyeScore=Math.max(0,1-Math.abs(eyeR-0.19)*9);

  // 4. Jaw/cheek ratio
  const jawW=Math.abs(pts[4].x-pts[12].x)/faceW;
  const jawScore=Math.min(1,jawW*1.6);

  // Combine with small random noise for realism
  const raw=sym*.42+prop*.28+eyeScore*.18+jawScore*.12;
  const noise=(Math.random()-.5)*.015;
  return Math.min(100,Math.max(0,Math.round((raw+noise)*100)));
}

async function detectScore(videoEl){
  if(!faceApiReady||videoEl.readyState<2)return null;
  try{
    const det=await faceapi
      .detectSingleFace(videoEl,new faceapi.TinyFaceDetectorOptions({scoreThreshold:.28,inputSize:224}))
      .withFaceLandmarks(true);
    if(!det)return null;
    return computeScore(det.landmarks);
  }catch{return null;}
}

function emaSmooth(key,val,alpha=.25){
  if(ema[key]==null)ema[key]=val;
  else ema[key]=alpha*val+(1-alpha)*ema[key];
  return Math.round(ema[key]);
}

function getMogTerm(s){
  if(s>=100)return'👑 MOGGER FINAL BOSS';
  if(s>=99) return'🌟 GOD TIER';
  if(s>=98) return'⚡ GIGACHAD';
  if(s>=97) return'💎 NEAR GIGACHAD';
  if(s>=96) return'🔥 GIGACHAD CANDIDATE';
  if(s>=95) return'✨ ELITE CHAD';
  if(s>=94) return'🏆 CHAD SUPREME';
  if(s>=93) return'💪 ALPHA CHAD';
  if(s>=92) return'🔱 FULL CHAD';
  if(s>=91) return'✅ CERTIFIED CHAD';
  if(s>=90) return'💥 CHAD';
  if(s>=89) return'⚡ PRE-CHAD';
  if(s>=88) return'🔥 ULTRA CHADALITE';
  if(s>=87) return'💪 PEAK CHADALITE';
  if(s>=86) return'🌟 SERIOUS CHADALITE';
  if(s>=85) return'✨ CHAD-IN-TRAINING';
  if(s>=84) return'💎 HIGH CHADALITE';
  if(s>=83) return'🏅 ALPHA MATERIAL';
  if(s>=82) return'⬆️ RISING CHAD';
  if(s>=81) return'🔥 CHADALITE+';
  if(s>=80) return'⚡ CHADALITE';
  if(s>=79) return'🎯 PROTO-CHAD';
  if(s>=78) return'🌟 NEAR CHADALITE';
  if(s>=77) return'💡 SIGMA CANDIDATE';
  if(s>=76) return'📈 HIGH VALUE';
  if(s>=75) return'💫 VERY ATTRACTIVE';
  if(s>=74) return'✨ ATTRACTIVE';
  if(s>=73) return'👀 HEAD TURNER';
  if(s>=72) return'⚡ STRIKING';
  if(s>=71) return'💪 HANDSOME';
  if(s>=70) return'😎 GOOD LOOKING';
  if(s>=69) return'🎯 ALMOST ELITE';
  if(s>=68) return'✅ VERY SOLID';
  if(s>=67) return'🔥 SHARP';
  if(s>=66) return'✨ FRESH';
  if(s>=65) return'👌 LOOKS GOOD';
  if(s>=64) return'👁️ NOTICEABLE';
  if(s>=63) return'📊 ABOVE AVERAGE';
  if(s>=62) return'💪 SOLID';
  if(s>=61) return'✅ RESPECTABLE';
  if(s>=60) return'😐 DECENT';
  if(s>=59) return'🔜 APPROACHING DECENT';
  if(s>=58) return'🤔 NOT BAD ACTUALLY';
  if(s>=57) return'🌡️ GETTING WARMER';
  if(s>=56) return'📈 SLIGHTLY ABOVE MID';
  if(s>=55) return'⏳ ALMOST THERE';
  if(s>=54) return'😑 MEDIOCRE';
  if(s>=53) return'📊 MID';
  if(s>=52) return'😶 MID TIER';
  if(s>=51) return'🙂 SLIGHTLY AVERAGE';
  if(s>=50) return'😐 AVERAGE';
  if(s>=49) return'📉 SUB-PAR';
  if(s>=45) return'😬 BELOW AVERAGE';
  if(s>=40) return'👺 GREMLIN';
  if(s>=35) return'🧌 GOBLIN MODE';
  if(s>=30) return'👻 BACKGROUND CHARACTER';
  if(s>=20) return'🤖 NPC TIER';
  return'💀 DELETE ACCOUNT';
}

function setAiScore(side,score){
  const numEl  =side==='left'?leftAiNum:rightAiNum;
  const barEl  =side==='left'?leftAiBar:rightAiBar;
  const statEl =side==='left'?leftAiStatus:rightAiStatus;
  if(score==null){
    numEl.textContent='—';barEl.style.width='0%';
    statEl.textContent='NO FACE DETECTED';return;
  }
  const s=emaSmooth(side,score);
  const tenths=(s/10).toFixed(1);
  numEl.textContent=tenths;
  barEl.style.width=s+'%';
  statEl.textContent=getMogTerm(s);
  // Color: red<5, purple 5-7, blue 7-8, teal 8-9, gold 9+, rainbow 10
  barEl.style.background=
    s>=100?'linear-gradient(90deg,#ffd700,#ff6b00,#ff0000)':
    s>=90 ?'linear-gradient(90deg,#ffd700,#ffaa00)':
    s>=80 ?'linear-gradient(90deg,#4fffb0,#00ccff)':
    s>=70 ?'linear-gradient(90deg,#4fffb0,#00ff88)':
    s>=60 ?'linear-gradient(90deg,#8c5cff,#00ccff)':
    s>=50 ?'linear-gradient(90deg,#8c5cff,#c45cff)':
           'linear-gradient(90deg,#ff5c8a,#ff5c5c)';
}

/* Run detection loop every 700ms */
let detectionInterval=null;
const avgScores={left:[],right:[]}; // accumulate during round for winner calc

async function runDetect(side,videoEl){
  const det=await faceapi
    .detectSingleFace(videoEl,new faceapi.TinyFaceDetectorOptions({scoreThreshold:.28,inputSize:224}))
    .withFaceLandmarks(true);
  if(det){
    lastLandmarks[side]=det.landmarks;
    const sc=computeScore(det.landmarks);
    setAiScore(side,sc);
    avgScores[side].push(sc); // accumulate for round winner
  }else{
    lastLandmarks[side]=null;
    setAiScore(side,null);
  }
}
function startDetection(){
  if(detectionInterval)clearInterval(detectionInterval);
  detectionInterval=setInterval(async()=>{
    if(faceApiReady){
      if(activePair.left  && leftVideo.srcObject  && leftVideo.readyState>=2)  runDetect('left', leftVideo).catch(()=>{});
      if(activePair.right && rightVideo.srcObject && rightVideo.readyState>=2) runDetect('right',rightVideo).catch(()=>{});
    }
  },700);
}
function stopDetection(){clearInterval(detectionInterval);detectionInterval=null;}

/* ══════════════════════════════════════════
   VOTE BAR ANIMATION
══════════════════════════════════════════ */
function updateVoteBars(lv,rv){
  const total=lv+rv||1;
  const lp=Math.round(lv/total*100),rp=Math.round(rv/total*100);
  leftFill.style.width=lp+'%';  rightFill.style.width=rp+'%';
  leftVotePct.textContent=lp+'%';rightVotePct.textContent=rp+'%';
  leftVotes.textContent=lv+' vote'+(lv!==1?'s':'');
  rightVotes.textContent=rv+' vote'+(rv!==1?'s':'');
  // winning badges
  if(lv>rv){leftBadge.classList.remove('hidden');rightBadge.classList.add('hidden');leftRing.classList.add('active');rightRing.classList.remove('active');}
  else if(rv>lv){rightBadge.classList.remove('hidden');leftBadge.classList.add('hidden');rightRing.classList.add('active');leftRing.classList.remove('active');}
  else{leftBadge.classList.add('hidden');rightBadge.classList.add('hidden');leftRing.classList.remove('active');rightRing.classList.remove('active');}
}

/* ══════════════════════════════════════════
   UI HELPERS
══════════════════════════════════════════ */
function showToast(msg){
  clearTimeout(toastTimer);toast.textContent=msg;toast.classList.remove('hidden');
  toastTimer=setTimeout(()=>toast.classList.add('hidden'),2800);
}
function setErr(msg){joinError.textContent=msg||'';}
function setRoomVisible(v){
  joinScreen.classList.toggle('hidden',v);roomScreen.classList.toggle('hidden',!v);
  if(v)document.dispatchEvent(new Event('roomEntered'));
}
/* ══════════════════════════════════════════
   ROUND TIMER
══════════════════════════════════════════ */
const roundTimer=$('roundTimer');
const timerCount=$('timerCount');
const timerArc=$('timerArc');
const ROUND_SECS=30;
const CIRC=163; // 2*pi*26
let roundTimerInterval=null;

function startRoundTimer(){
  stopRoundTimer();
  avgScores.left=[];avgScores.right=[];
  let secs=ROUND_SECS;
  roundTimer.classList.remove('hidden');
  timerCount.textContent=secs;
  timerArc.style.strokeDashoffset=0;
  timerArc.classList.remove('urgent');
  roundTimerInterval=setInterval(()=>{
    secs--;
    timerCount.textContent=secs;
    timerArc.style.strokeDashoffset=CIRC*(1-(secs/ROUND_SECS));
    if(secs<=10)timerArc.classList.add('urgent');
    if(secs<=0){
      stopRoundTimer();
      // Determine winner by average AI score
      const la=avgScores.left.length?avgScores.left.reduce((a,b)=>a+b,0)/avgScores.left.length:0;
      const ra=avgScores.right.length?avgScores.right.reduce((a,b)=>a+b,0)/avgScores.right.length:0;
      const lName=activePair.left?.name||'Left';
      const rName=activePair.right?.name||'Right';
      if(la>ra) showResult({name:lName,score:la,side:'left'});
      else if(ra>la) showResult({name:rName,score:ra,side:'right'});
      else showResult(null);
    }
  },1000);
}
function stopRoundTimer(){
  clearInterval(roundTimerInterval);roundTimerInterval=null;
  roundTimer.classList.add('hidden');
}

function showResult(winner){
  const s=winner?Math.round(winner.score):0;
  $('resultTitle').textContent=winner?`${winner.name} Mogs! 👑`:"It's a Tie!";
  $('resultScore').textContent=winner?(s/10).toFixed(1)+' / 10':'';
  $('resultTerm').textContent=winner?getMogTerm(s):'';
  $('resultCrown').textContent=winner?'👑':'🤝';
  $('resultDesc').textContent=winner?'AI analysis complete.':'Both faces equally matched.';
  resultOverlay.classList.remove('hidden');
}
resultClose.addEventListener('click',()=>{
  resultOverlay.classList.add('hidden');
  stopRoundTimer();
});
// nextRoundBtn inside win screen
const nextRoundBtn2=$('nextRoundBtn2');
if(nextRoundBtn2)nextRoundBtn2.addEventListener('click',()=>{
  resultOverlay.classList.add('hidden');
  stopRoundTimer();
  if(nextRoundBtn&&!nextRoundBtn.disabled)nextRoundBtn.click();
});

/* ══════════════════════════════════════════
   MEDIA
══════════════════════════════════════════ */
async function ensureMedia(){
  if(localStream)return localStream;
  try{
    localStream=await navigator.mediaDevices.getUserMedia({video:true,audio:true});
  }catch(e){
    // Try video-only as fallback (mic might be blocked)
    if(e.name==='NotFoundError'||e.name==='OverconstrainedError'){
      try{localStream=await navigator.mediaDevices.getUserMedia({video:true,audio:false});}catch(e2){throw e2;}
    } else {
      const msg=
        e.name==='NotAllowedError'?'Camera blocked — allow camera in browser settings':
        e.name==='NotReadableError'?'Camera in use by another app — close it and retry':
        e.name==='SecurityError'?'HTTPS required for camera access':
        'Camera error: '+e.message;
      const err=new Error(msg);err.name=e.name;throw err;
    }
  }
  localVideo.srcObject=localStream;
  localVideo.play().catch(()=>{});
  return localStream;
}

/* ══════════════════════════════════════════
   WebRTC
══════════════════════════════════════════ */
function createPeer(rid,offer){
  if(peers.has(rid))return peers.get(rid);
  const pc=new RTCPeerConnection(rtcConfig);
  peers.set(rid,pc);
  localStream.getTracks().forEach(t=>pc.addTrack(t,localStream));
  pc.onicecandidate=e=>{if(e.candidate)socket.emit('signal',{to:rid,data:{type:'candidate',candidate:e.candidate}});};
  pc.ontrack=e=>{remoteStreams.set(rid,e.streams[0]);renderVideos();};
  pc.onconnectionstatechange=()=>{if(['failed','closed','disconnected'].includes(pc.connectionState)){peers.delete(rid);remoteStreams.delete(rid);renderVideos();}};
  if(offer){
    pc.createOffer().then(o=>pc.setLocalDescription(o)).then(()=>socket.emit('signal',{to:rid,data:pc.localDescription})).catch(()=>showToast('Video connection failed.'));
  }
  return pc;
}

async function handleSignal({from,data}){
  if(!localStream)return;
  const pc=createPeer(from,false);
  if(data.type==='offer'){await pc.setRemoteDescription(new RTCSessionDescription(data));const a=await pc.createAnswer();await pc.setLocalDescription(a);socket.emit('signal',{to:from,data:pc.localDescription});}
  else if(data.type==='answer'){await pc.setRemoteDescription(new RTCSessionDescription(data));}
  else if(data.type==='candidate'){await pc.addIceCandidate(new RTCIceCandidate(data.candidate));}
}

function streamFor(user){
  if(!user)return null;
  return user.id===selfId?localStream:remoteStreams.get(user.id)||null;
}

function assignVideo(el, stream) {
  if (el.srcObject === stream) return;
  el.srcObject = stream;
  if (stream) {
    // Must call play() — autoplay alone can silently fail on unmuted video
    el.play().catch(() => {});
  }
}

function renderVideos(){
  // Primary streams from active pair
  let ls = streamFor(activePair.left);
  let rs = streamFor(activePair.right);

  // Fallback: if no left stream but we have a local camera, always show self on left
  // This prevents a totally black screen when waiting for a second person
  if (!ls && localStream) ls = localStream;

  assignVideo(leftVideo, ls);
  assignVideo(rightVideo, rs);

  if(ls) startTracker(leftVideo,  leftTracker,  'rgb(92,138,255)',  'left');
  else   stopTracker(leftVideo);
  if(rs) startTracker(rightVideo, rightTracker, 'rgb(255,92,138)', 'right');
  else   stopTracker(rightVideo);

  if(!ls){ ema.left=null;  setAiScore('left',  null); }
  if(!rs){ ema.right=null; setAiScore('right', null); }
}

/* ══════════════════════════════════════════
   ROOM STATE
══════════════════════════════════════════ */
function renderRoom(room){
  currentRoomId=room.roomId;activePair=room.activePair;
  copyRoomBtn.textContent=room.roomId;
  leftName.textContent=room.activePair.left?.name||'Waiting…';
  rightName.textContent=room.activePair.right?.name||'Waiting…';
  updateVoteBars(room.votes.left,room.votes.right);
  const ok=!!(room.activePair.left&&room.activePair.right);
  voteLeftBtn.disabled=!ok||hasVoted;
  voteRightBtn.disabled=!ok||hasVoted;
  nextRoundBtn.disabled=room.users.length<2;

  // User list
  const active=[room.activePair.left?.id,room.activePair.right?.id];
  userList.innerHTML='';
  room.users.forEach(u=>{
    const li=document.createElement('li');
    li.textContent=(u.id===selfId)?`${u.name} (you)`:u.name;
    if(u.id===selfId)li.classList.add('me');
    if(active.includes(u.id))li.classList.add('on-stage');
    userList.append(li);
  });

  // Scoreboard
  scoreboard.innerHTML='';
  [...room.users].map(u=>({...u,wins:room.scoreboard[u.id]||0}))
    .sort((a,b)=>b.wins-a.wins||a.name.localeCompare(b.name))
    .forEach((u,i)=>{
      const li=document.createElement('li');
      const medal=i===0&&u.wins>0?'👑 ':'';
      li.innerHTML=`<span>${medal}${u.name}</span><span class="score-win">${u.wins}W</span>`;
      scoreboard.append(li);
    });

  room.users.forEach(u=>{if(u.id!==selfId)createPeer(u.id,selfId>u.id);});
  renderVideos();
  if(ok){startDetection();startRoundTimer();}else{stopDetection();stopRoundTimer();}
}

/* ══════════════════════════════════════════
   JOIN / CREATE
══════════════════════════════════════════ */
async function joinRoom(roomId){
  setErr('');hasVoted=false;
  showLoading();
  try{
    await ensureMedia();
  }catch(e){
    hideLoading();
    setErr('Camera permission required.');
    return;
  }
  socket.emit('join-room',{roomId,name:nameInput.value.trim()||'Guest'},res=>{
    if(!res.ok){hideLoading();setErr(res.error);return;}
    selfId=res.selfId;connStatus.textContent='Connected';
    hideLoading();
    setRoomVisible(true);renderRoom(res.room);
    history.replaceState(null,'',`/room/${res.room.roomId}`);
  });
}

createRoomBtn.addEventListener('click',()=>{
  if(!nameInput.reportValidity())return;
  socket.emit('create-room',({roomId})=>{roomInput.value=roomId;joinRoom(roomId).catch(e=>setErr(e.message||'Camera error.'));});
});

joinForm.addEventListener('submit',e=>{
  e.preventDefault();
  const rid=roomInput.value.trim();
  if(!rid)socket.emit('create-room',({roomId})=>{roomInput.value=roomId;joinRoom(roomId).catch(e=>setErr(e.message||'Camera error.'));});
  else joinRoom(rid).catch(e=>setErr(e.message||'Camera error.'));
});

copyRoomBtn.addEventListener('click',async()=>{
  try{await navigator.clipboard.writeText(`${location.origin}/room/${currentRoomId}`);}catch(_){}
  showToast('📋 Invite link copied!');
});

/* ── Vote ───────────────────────────────── */
function castVote(side){
  if(hasVoted)return;hasVoted=true;
  voteLeftBtn.disabled=voteRightBtn.disabled=true;
  socket.emit('vote',{side});showToast(`✅ Voted for ${side==='left'?leftName.textContent:rightName.textContent}!`);
}
voteLeftBtn.addEventListener('click',()=>castVote('left'));
voteRightBtn.addEventListener('click',()=>castVote('right'));

nextRoundBtn.addEventListener('click',()=>{
  hasVoted=false;
  socket.emit('next-round');
  ema.left=null;ema.right=null;
  avgScores.left=[];avgScores.right=[];
});
leaveBtn.addEventListener('click',()=>location.assign('/'));

/* ══════════════════════════════════════════
   SOCKET EVENTS
══════════════════════════════════════════ */
socket.on('connect',()=>{connStatus.textContent='Connected';});
socket.on('disconnect',()=>{connStatus.textContent='Disconnected';stopDetection();});
socket.on('user-joined',u=>{if(localStream)createPeer(u.id,selfId>u.id);showToast(`👋 ${u.name} joined!`);});
socket.on('user-left',id=>{peers.get(id)?.close();peers.delete(id);remoteStreams.delete(id);renderVideos();});
socket.on('signal',p=>handleSignal(p).catch(()=>showToast('Video signal failed.')));
socket.on('room-state',renderRoom);
socket.on('round-result',({winner,votes})=>{
  updateVoteBars(votes.left,votes.right);
  // Only show server result if timer hasn't already shown it
  if(resultOverlay.classList.contains('hidden')){
    if(winner){
      // Use the last EMA score for the winner for the display
      const scoreSide = (winner.id === activePair.left?.id) ? 'left' : 'right';
      const score = ema[scoreSide] || 50;
      showResult({name: winner.name, score});
    } else {
      showResult(null);
    }
  }
});

/* Auto-fill room from URL */
const rp=location.pathname.match(/^\/room\/([^/]+)/)?.[1];
if(rp)roomInput.value=rp.toUpperCase();
