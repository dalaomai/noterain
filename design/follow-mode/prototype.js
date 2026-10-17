'use strict';
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const main = $('.main-content');
const app = $('.app');
const toolbar = $('#playback-toolbar');
const preferenceKey='noterain-follow-prototype-feedback-v1';
const feedback={pitch:true,timing:true,velocity:true};
try{const saved=JSON.parse(localStorage.getItem(preferenceKey));for(const key of Object.keys(feedback))if(typeof saved?.[key]==='boolean')feedback[key]=saved[key];}catch{}
const state = { view:'original', scene:'waiting', compare:false, chordDone:new Set([48,52]), timer:null, demoStep:0, tooltip:false, followMode:true, feedback };
const sceneData = {
 waiting:{tone:'wait',time:null,velocity:null,label:'等你弹 G4',description:'当前音轻轻呼吸，乐谱保持原位。'},
 good:{tone:'good',time:20,velocity:65,label:'G4 · 音高正确',description:'晚 20 ms，在 ±80 ms 区间内；力度 65，参考 64。'},
 early:{tone:'adjust',time:-150,velocity:42,label:'G4 · 偏早、偏轻',description:'早 150 ms；力度 42，参考 64。左侧刻度表示偏早，小环表示偏轻。'},
 late:{tone:'adjust',time:110,velocity:84,label:'G4 · 偏晚、偏重',description:'晚 110 ms；力度 84，参考 64。右侧刻度表示偏晚，大环表示偏重。'},
 wrong:{tone:'wrong',time:null,velocity:null,label:'请弹 G4',description:'刚才输入 F4。只提示音高错误，不评价本次时间或力度。'},
 chord:{tone:'wait',time:null,velocity:null,label:'C3 · E3 · G3，已完成 2/3',description:'C3、E3 已完成；G3 呼吸等待。补 G3 后继续。'},
 completed:{tone:'neutral',time:'waited',velocity:65,label:'G4 · 等待后完成',description:'等待后补弹不计入准时率。力度 65，参考 64。'},
 unavailable:{tone:'good',time:20,velocity:'unavailable',label:'G4 · 力度不可评估',description:'音高正确、时间准时；固定力度输入不显示实际力度环。'}
};
app.id='existing-app';
const piano = main.querySelector('[class*="_keyboard_"]');
piano.id='existing-piano';
const layer = document.createElement('div');layer.id='feedback-layer';layer.setAttribute('aria-hidden','true');main.append(layer);
const tooltip = document.createElement('div');tooltip.id='cue-tooltip';tooltip.className='cue-tooltip';tooltip.hidden=true;main.append(tooltip);
let renderer = main.firstElementChild;
let source;
let audio;
function sizeName(){return window.innerWidth<=600?'mobile':'desktop';}
function data(){
 if(state.scene==='chord')return {...sceneData.chord,label:`C3 · E3 · G3，已完成 ${state.chordDone.size}/3`,description:state.chordDone.size===3?'和弦已补齐，三个音均已完成。':'C3、E3 已完成；G3 呼吸等待。补 G3 后继续。'};
 return sceneData[state.scene];
}
function setScene(name){state.scene=name;state.chordDone=new Set([48,52]);$('#scene-select').value=name;state.tooltip=false;tooltip.hidden=true;renderFeedback(true);updateHint();}
function updateHint(){
 $('#review-hint').textContent=state.compare?'对比中：只隐藏新增反馈，乐谱和键盘的位置、宽度保持不变。':state.scene==='chord'?'同一和弦，三种视图共用点亮 / 呼吸反馈。按 G 补齐 G3；点击音符查看详情。':'三种视图，同一音（G4），同一套反馈。按 G 试弹 · 点击音符查看详情 · 演示台可收起。';
}
function showView(view){
 state.view=view;
 source=window.NR_SCORE_VIEWS[`${sizeName()}-${view}`];
 const holder=document.createElement('template');holder.innerHTML=source.html;
 const replacement=holder.content.firstElementChild;
 replacement.id='score-renderer';
 if(view==='falling'){
  replacement.replaceChildren();
  const img=new Image();img.className='captured-falling';img.alt='现有下落音符视图，G4 的等待时刻';img.src=source.canvas;replacement.append(img);
 }
 renderer.replaceWith(replacement);renderer=replacement;
 // Existing SVG engraving is retained, including original clefs, beams, rests,
 // lyrics space, system breaks, colors and note sizes. No score is redrawn.
 $$('.view-switch button').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.view===view)));
 $$('[data-settings-view]').forEach(b=>{const active=b.dataset.settingsView===view||(b.dataset.settingsView==='staff'&&view!=='falling');b.classList.toggle('_active_1vvyv_281',active);b.setAttribute('aria-pressed',String(active));});
 renderer.addEventListener('scroll',()=>renderFeedback(false));
 renderer.addEventListener('click',e=>{
  const group=e.target.closest('.note,.vf-stavenote');
  const targetId=view==='original'?(state.scene==='chord'?'bass-1-3':'melody-1-3'):view==='simplified'?(state.scene==='chord'?source.heads[4].id:source.heads[2].id):null;
  if(view==='falling'){const a=pitchAnchor(state.scene==='chord'?55:67),r=main.getBoundingClientRect();if(a&&Math.abs(e.clientX-r.left-a.x)<40&&Math.abs(e.clientY-r.top-a.y)<90)showDetail();}
  else if(group?.id===targetId)showDetail();
 });
 requestAnimationFrame(()=>{renderFeedback(false);if(state.tooltip)showDetail();});
}
function noteHead(id,subIndex=0){
 const group=renderer.querySelector('#'+CSS.escape(id));
 if(!group)return null;
 const head=group.querySelectorAll('.notehead,.vf-notehead')[subIndex];
 if(!head)return null;
 const mainRect=main.getBoundingClientRect();
 if(state.view==='simplified'){
  const text=head.querySelector('text');
  if(!text)return null;
  const p=new DOMPoint(Number(text.getAttribute('x'))+6,Number(text.getAttribute('y'))).matrixTransform(text.getScreenCTM());
  const stem=group.querySelector('.vf-stem')?.getBoundingClientRect();
  return {x:p.x-mainRect.left,y:p.y-mainRect.top,timingY:(stem?.top||p.y-30)-mainRect.top-15};
 }
 const r=head.getBoundingClientRect(),g=group.getBoundingClientRect();
 return {x:r.x+r.width/2-mainRect.left,y:r.y+r.height/2-mainRect.top,timingY:g.top-mainRect.top-15};
}
function pitchAnchor(pitch){
 const base=main.getBoundingClientRect();
 if(state.view==='falling'){
  const r=renderer.getBoundingClientRect();
  const whites=[];for(let p=39;p<=71;p++)if(![1,3,6,8,10].includes(p%12))whites.push(p);
  const lane=whites.indexOf(pitch);
  return {x:r.left-base.left+(lane+.5)/whites.length*r.width,y:r.bottom-base.top-17,timingY:r.bottom-base.top-62};
 }
 if(pitch===67){
  if(state.view==='original')return noteHead('melody-1-3');
  return noteHead(source.heads[2].id);
 }
 const chordPitches=[48,52,55],index=chordPitches.indexOf(pitch);
 if(state.view==='original')return noteHead(`bass-1-${index+1}`);
 return noteHead(source.heads[4].id,index);
}
function ring(cls,r){return `<i class="note-ring ${cls}"${r?` style="--r:${r}px"`:''}></i>`;}
function signal(kind,tone,html){return `<span class="feedback-signal ${tone}" data-feedback="${kind}">${html}</span>`;}
function drawMark(anchor,result,animate,extra={}){
 if(!anchor||!state.followMode)return;
 const mark=document.createElement('div');
 mark.className=`feedback-mark ${result.tone}`;
 mark.dataset.pitch=String(extra.pitch||67);
 mark.dataset.signal=result.time==='waited'?'completed':result.time===null?'pitch':'pitch-time-force';
 mark.style.left=`${anchor.x}px`;mark.style.top=`${anchor.y}px`;
 mark.style.setProperty('--timing-top',`${Math.max(9,anchor.timingY)-anchor.y}px`);
 let html='';
 if(extra.chord){
  if(feedback.pitch)html=signal('pitch',result.tone,extra.done?'<i class="chord-dot"></i>':ring('wait',9));
 }else if(state.scene==='waiting'){if(feedback.pitch)html=signal('pitch','wait',ring('wait',12));}
 else if(state.scene==='wrong'){if(feedback.pitch)html=signal('pitch','wrong',ring('wrong-ring',12)+'<span class="pitch-cross">×</span>');}
 else{
  if(feedback.velocity){
   const supported=typeof result.velocity==='number';
   let forceHtml=ring('reference',12);
   if(supported){
   const r=Math.max(8,Math.min(18,result.velocity/64*12));
   mark.style.setProperty('--actual-radius',`${r}px`);
    forceHtml+=ring('force');
    if(Math.abs(result.velocity-64)>12)forceHtml+=`<span class="force-direction">${result.velocity<64?'↑':'↓'}</span>`;
   }else forceHtml+=ring('invalid',12);
   html+=signal('velocity',!supported?'neutral':Math.abs(result.velocity-64)>12?'adjust':'good',forceHtml);
  }
  if(feedback.timing&&result.time==='waited')html+=signal('timing','neutral','<span class="timing-cue waited"><span class="direction">Ⅱ</span></span>');
  else if(feedback.timing&&typeof result.time==='number'){
   const offset=Math.max(-16,Math.min(16,result.time/10));
   const timingClass=Math.abs(result.time)<=80?'on-time':result.time<0?'early':'late';
   html+=signal('timing',timingClass==='on-time'?'good':'adjust',`<span class="timing-cue ${timingClass}" style="--time-offset:${offset}px"><i class="range"></i><i class="zero"></i><i class="needle"></i>${Math.abs(result.time)>80?`<span class="direction">${result.time<0?'‹':'›'}</span>`:''}</span>`);
  }
  if(feedback.pitch){
   let pitchHtml=ring('pitch-result',10);
   if(animate){
    pitchHtml+=ring('hit',11);
    for(let i=0;i<5;i++){const a=i/5*Math.PI*2;pitchHtml+=`<i class="feedback-spark" style="--dx:${Math.cos(a)*22}px;--dy:${Math.sin(a)*22}px"></i>`;}
   }
   html+=signal('pitch','good',pitchHtml);
  }
 }
 if(!html)return;
 mark.innerHTML=html;layer.append(mark);
}
function visibleDetail(){
 if(!state.followMode)return '';
 const d=data(),parts=[];
 if(feedback.pitch){
  if(state.scene==='chord')parts.push(d.label);
  else parts.push(state.scene==='wrong'?'刚才输入 F4，请弹 G4':state.scene==='waiting'?'等你弹 G4':'G4 · 音高正确');
 }
 if(feedback.timing){
  if(d.time==='waited')parts.push('等待后完成，不计入准时率');
  else if(typeof d.time==='number')parts.push(`${d.time<0?'早':'晚'} ${Math.abs(d.time)} ms${Math.abs(d.time)<=80?'，在 ±80 ms 区间内':''}`);
 }
 if(feedback.velocity){
  if(typeof d.velocity==='number')parts.push(`力度 ${d.velocity}，参考 64`);
  else if(d.velocity==='unavailable')parts.push('固定力度输入，力度不可评估');
 }
 return parts.join('；');
}
function renderFeedback(animate=false){
 layer.replaceChildren();
 if(state.scene==='chord'){
  [48,52,55].forEach(p=>drawMark(pitchAnchor(p),{tone:state.chordDone.has(p)?'good':'wait',time:null},animate,{chord:true,done:state.chordDone.has(p),pitch:p}));
 }else drawMark(pitchAnchor(67),data(),animate);
 $('#accessible-feedback').textContent=visibleDetail();
 if(state.tooltip)showDetail();
}
function showDetail(){
 const detail=visibleDetail();
 if(state.compare||!detail){state.tooltip=false;tooltip.hidden=true;return;}
 state.tooltip=true;
 const a=pitchAnchor(state.scene==='chord'?55:67);if(!a)return;
 tooltip.innerHTML=`<button aria-label="关闭音符详情">×</button><strong>${state.scene==='chord'?'当前和弦':'当前音符'}</strong><small>${detail}</small>`;
 tooltip.hidden=false;
 const width=Math.min(205,main.clientWidth-24),height=80;
 let left=a.x+25,top=a.timingY-8;
 if(left+width>main.clientWidth-8)left=Math.max(8,a.x-width-25);
 if(top+height>layer.clientHeight-8)top=Math.max(8,a.y-height-25);
 tooltip.style.left=`${left}px`;tooltip.style.top=`${Math.max(8,top)}px`;
 tooltip.querySelector('button').onclick=()=>{tooltip.hidden=true;state.tooltip=false;};
}
function tone(pitch){
 try{audio ||= new (window.AudioContext||window.webkitAudioContext)();void audio.resume();
 const osc=audio.createOscillator(),gain=audio.createGain();osc.type='triangle';osc.frequency.value=440*2**((pitch-69)/12);
 gain.gain.setValueAtTime(.0001,audio.currentTime);gain.gain.exponentialRampToValueAtTime(.065,audio.currentTime+.008);gain.gain.exponentialRampToValueAtTime(.0001,audio.currentTime+.45);
 osc.connect(gain);gain.connect(audio.destination);osc.start();osc.stop(audio.currentTime+.5);osc.onended=()=>{osc.disconnect();gain.disconnect();};}catch{}
}
function input(pitch){
 if(state.compare)return;
 tone(pitch);
 if(!state.followMode)return;
 if(state.scene==='chord'){
  if([48,52,55].includes(pitch))state.chordDone.add(pitch);
  if(state.chordDone.size===3){
   renderFeedback(true);
   $('#review-hint').textContent='和弦已补齐：三个相同圆环全部点亮，下一拍继续。';
  }else renderFeedback(false);
 }else setScene(pitch===67?'unavailable':'wrong');
}
function stopDemo(){clearInterval(state.timer);state.timer=null;const icon=toolbar.querySelector('.lucide-pause');if(icon){icon.classList.replace('lucide-pause','lucide-play');icon.innerHTML='<polygon points="6 3 20 12 6 21 6 3"></polygon>';}}
function playDemo(){
 if(state.timer){stopDemo();return;}
 const order=['waiting','good','early','late','wrong','completed','unavailable'];let i=0;
 const icon=toolbar.querySelector('.lucide-play');if(icon){icon.classList.replace('lucide-play','lucide-pause');icon.innerHTML='<path d="M6 4h4v16H6zM14 4h4v16h-4z"></path>';}
 setScene(order[i++]);state.timer=setInterval(()=>{setScene(order[i++%order.length]);},2000);
}
function originalButton(icon){return toolbar.querySelector(`.${icon}`)?.closest('button');}
originalButton('lucide-play')?.addEventListener('click',playDemo);
originalButton('lucide-square')?.addEventListener('click',()=>{stopDemo();setScene('waiting');});
const settings=$('aside._grid_1vvyv_69');settings.id='existing-settings';
const settingsButton=originalButton('lucide-sliders-horizontal');
const backdrop=$('._backdrop_1vvyv_164');
settingsButton.setAttribute('aria-controls',settings.id);settingsButton.setAttribute('aria-expanded','false');
backdrop.tabIndex=-1;backdrop.setAttribute('aria-hidden','true');
function setSettings(open){
 settings.classList.toggle('_sidebarOpen_1vvyv_143',open);settings.setAttribute('aria-hidden',String(!open));settings.inert=!open;
 backdrop.classList.toggle('_backdropVisible_1vvyv_177',open);settingsButton.setAttribute('aria-expanded',String(open));
 if(open){
  stopDemo();
  settings.scrollTop=0;
  settings.scrollTop=$('#practice-settings').getBoundingClientRect().top-settings.getBoundingClientRect().top-62;
  settings.querySelector('._sidebarHeader_1vvyv_147 button').focus({preventScroll:true});
 }else settingsButton.focus({preventScroll:true});
}
settingsButton.addEventListener('click',()=>setSettings(settings.inert));
settings.querySelector('._sidebarHeader_1vvyv_147 button').addEventListener('click',()=>setSettings(false));
backdrop.addEventListener('click',()=>setSettings(false));
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!settings.inert){e.preventDefault();setSettings(false);}});
document.addEventListener('pointerdown',e=>{if(!settings.inert&&!settings.contains(e.target)&&!settingsButton.contains(e.target)&&e.target!==backdrop)setSettings(false);});
for(const key of Object.keys(feedback)){
 const control=$(`#feedback-${key}`);control.checked=feedback[key];
 control.addEventListener('change',()=>{feedback[key]=control.checked;try{localStorage.setItem(preferenceKey,JSON.stringify(feedback));}catch{}renderFeedback(false);});
}
$('#follow-mode').checked=true;
$('#follow-mode').addEventListener('change',e=>{state.followMode=e.target.checked;$('#feedback-options').disabled=!state.followMode;stopDemo();renderFeedback(false);});
$$('[data-settings-view]').forEach(b=>b.addEventListener('click',()=>{showView(b.dataset.settingsView==='staff'?'original':b.dataset.settingsView);updateHint();}));
originalButton('lucide-maximize')?.addEventListener('click',()=>{document.body.classList.toggle('review-hidden');const hidden=document.body.classList.contains('review-hidden');$('#review-dock').hidden=hidden;$('#show-dock').hidden=!hidden;requestAnimationFrame(()=>renderFeedback(false));});
// Keep the original source toolbar intact. Import/history are outside this scoped prototype.
const fileInput=$('input[type=file]');if(fileInput){fileInput.disabled=true;fileInput.title='此原型使用示例曲目';}
const history=toolbar.querySelector('.lucide-clock')?.closest('button');if(history)history.addEventListener('click',()=>$('#review-help').showModal());
const progress=toolbar.querySelector('input[type=range]');if(progress)progress.disabled=true;
const selector=toolbar.querySelector('select');if(selector)selector.disabled=true;
const white=[],black=[];for(let p=39;p<=71;p++)([1,3,6,8,10].includes(p%12)?black:white).push(p);
const whites=[...piano.querySelectorAll('[class*="_white_"]')],blacks=[...piano.querySelectorAll('[class*="_black_"]')];
[...whites.map((key,i)=>[key,white[i]]),...blacks.map((key,i)=>[key,black[i]])].forEach(([key,pitch])=>{
 key.dataset.pitch=pitch;key.setAttribute('role','button');key.setAttribute('aria-label',`演示弹奏 MIDI ${pitch}`);key.tabIndex=0;
 key.addEventListener('click',()=>input(pitch));key.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();input(pitch);}});
});
$$('[data-view]').forEach(b=>b.addEventListener('click',()=>{showView(b.dataset.view);updateHint();}));
$('#scene-select').addEventListener('change',e=>{stopDemo();setScene(e.target.value);});
$('#replay').addEventListener('click',()=>renderFeedback(true));
$('#baseline-toggle').addEventListener('click',()=>{state.compare=!state.compare;document.body.classList.toggle('comparing',state.compare);$('#baseline-toggle').setAttribute('aria-pressed',String(state.compare));updateHint();});
$('#hide-dock').addEventListener('click',()=>{document.body.classList.add('review-hidden');$('#review-dock').hidden=true;$('#show-dock').hidden=false;requestAnimationFrame(()=>renderFeedback(false));});
$('#show-dock').addEventListener('click',()=>{document.body.classList.remove('review-hidden');$('#review-dock').hidden=false;$('#show-dock').hidden=true;requestAnimationFrame(()=>renderFeedback(false));});
let lastSize=sizeName();
window.addEventListener('resize',()=>{const next=sizeName();if(next!==lastSize){lastSize=next;showView(state.view);}else requestAnimationFrame(()=>renderFeedback(false));});
const layoutObserver=new ResizeObserver(()=>requestAnimationFrame(()=>renderFeedback(false)));layoutObserver.observe(main);layoutObserver.observe(piano);
document.addEventListener('keydown',e=>{if(e.repeat||e.ctrlKey||e.metaKey||e.altKey||!settings.inert||/INPUT|SELECT|TEXTAREA/.test(e.target.tagName)||$('dialog[open]'))return;const map={a:60,s:62,d:64,f:65,g:67,h:69,j:71};const pitch=map[e.key.toLowerCase()];if(pitch){e.preventDefault();input(state.scene==='chord'&&pitch===67?55:pitch);}});
document.addEventListener('visibilitychange',()=>{if(document.hidden)stopDemo();});
showView('original');updateHint();
document.fonts.ready.then(()=>renderFeedback(false));
