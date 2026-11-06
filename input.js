// Player 1: keyboard, physical gamepad and independent multi-touch controls.
const K = { A:1, B:2, X:4, Y:8, LS:16, RS:32, L:64, R:128, ZL:256, ZR:512, PLUS:1024, MINUS:2048,
  LEFT:4096, UP:8192, RIGHT:16384, DOWN:32768 };
const KEYS = { ArrowUp:K.UP, ArrowDown:K.DOWN, ArrowLeft:K.LEFT, ArrowRight:K.RIGHT,
  KeyX:K.A, KeyZ:K.B, KeyS:K.X, KeyA:K.Y, KeyQ:K.L, KeyW:K.R, Digit1:K.ZL, Digit2:K.ZR,
  Enter:K.PLUS, Backspace:K.MINUS, KeyF:K.LS, KeyG:K.RS };
const PAD = [K.B,K.A,K.Y,K.X,K.L,K.R,K.ZL,K.ZR,K.MINUS,K.PLUS,K.LS,K.RS,K.UP,K.DOWN,K.LEFT,K.RIGHT];
const axis = v => Math.round(Math.max(-1,Math.min(1,Math.abs(v)<0.12?0:v))*32767);
const strongest = (a,b) => Math.abs(a)>Math.abs(b)?a:b;

export function startInput(api, game) {
  let keys=0, last='', focused=true;
  const held=new Map(), sticks={left:{x:0,y:0},right:{x:0,y:0}};
  const active=()=>!game.hidden&&focused&&document.visibilityState!=='hidden';
  const send=(...values)=>{const key=values.join();if(key!==last){last=key;api.SetInput(...values).catch(()=>{});}};
  const pad=document.createElement('div');pad.id='touchpad';pad.setAttribute('aria-label','Touch controller');
  const button=(key,label,cls='')=>`<button type="button" data-k="${key}" class="${cls}" aria-label="${key}">${label}</button>`;
  pad.innerHTML=`
    <div class="cluster left">${button('UP','▲','u')}${button('LEFT','◀','l')}${button('RIGHT','▶','r')}${button('DOWN','▼','d')}</div>
    <div class="cluster right">${button('X','X','u')}${button('Y','Y','l')}${button('A','A','r')}${button('B','B','d')}</div>
    <div class="analog left" data-stick="left" aria-label="Left analog stick"><span class="stick-nub"></span><span class="stick-label">L</span>${button('LS','L3','stick-click')}</div>
    <div class="analog right" data-stick="right" aria-label="Right analog stick"><span class="stick-nub"></span><span class="stick-label">R</span>${button('RS','R3','stick-click')}</div>
    <div class="shoulders">${button('ZL','ZL')}${button('L','L')}${button('MINUS','−')}${button('PLUS','+')}${button('R','R')}${button('ZR','ZR')}</div>`;
  game.appendChild(pad);
  const resetStick=side=>{sticks[side]={x:0,y:0};const el=pad.querySelector(`[data-stick="${side}"]`);el.classList.remove('held');el.querySelector('.stick-nub').style.transform='translate(0,0)';};
  const paintButtons=()=>{let bits=0;for(const item of held.values())if(item.kind==='button')bits|=item.key;for(const b of pad.querySelectorAll('[data-k]'))b.classList.toggle('held',!!(bits&K[b.dataset.k]));return bits;};
  const reset=()=>{keys=0;held.clear();resetStick('left');resetStick('right');paintButtons();send(0,0,0,0,0);};
  addEventListener('keydown',e=>{if(active()&&KEYS[e.code]){keys|=KEYS[e.code];e.preventDefault();}});
  addEventListener('keyup',e=>{if(KEYS[e.code]){keys&=~KEYS[e.code];if(active())e.preventDefault();}});
  addEventListener('blur',()=>{focused=false;reset();});addEventListener('focus',()=>{focused=true;});
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')reset();});
  new MutationObserver(()=>{if(game.hidden)reset();}).observe(game,{attributes:true,attributeFilter:['hidden']});
  const hit=e=>document.elementFromPoint(e.clientX,e.clientY)?.closest?.('#touchpad [data-k],#touchpad [data-stick]');
  const moveStick=(item,e)=>{
    let x=(e.clientX-item.cx)/item.radius,y=(item.cy-e.clientY)/item.radius;
    const distance=Math.hypot(x,y);if(distance>1){x/=distance;y/=distance;}
    sticks[item.side]={x:axis(x),y:axis(y)};
    item.element.querySelector('.stick-nub').style.transform=`translate(${x*26}px,${-y*26}px)`;
    item.element.classList.add('held');
  };
  pad.addEventListener('pointerdown',e=>{
    if(!active())return;const target=hit(e);if(!target)return;
    if(target.dataset.k)held.set(e.pointerId,{kind:'button',key:K[target.dataset.k]});
    else{
      const side=target.dataset.stick;if([...held.values()].some(p=>p.kind==='stick'&&p.side===side))return;
      const rect=target.getBoundingClientRect(),item={kind:'stick',side,element:target,cx:rect.x+rect.width/2,cy:rect.y+rect.height/2,radius:rect.width*.38};
      held.set(e.pointerId,item);moveStick(item,e);
    }
    pad.setPointerCapture(e.pointerId);paintButtons();e.preventDefault();
  });
  pad.addEventListener('pointermove',e=>{const item=held.get(e.pointerId);if(!item)return;if(item.kind==='stick')moveStick(item,e);else{const b=hit(e);item.key=b?.dataset.k?K[b.dataset.k]:0;paintButtons();}e.preventDefault();});
  const release=e=>{const item=held.get(e.pointerId);if(item?.kind==='stick')resetStick(item.side);held.delete(e.pointerId);paintButtons();};
  for(const type of ['pointerup','pointercancel','lostpointercapture'])pad.addEventListener(type,release);
  (function poll(){
    if(!active()){send(0,0,0,0,0);requestAnimationFrame(poll);return;}
    let buttons=keys;for(const item of held.values())if(item.kind==='button')buttons|=item.key;
    let lx=sticks.left.x,ly=sticks.left.y,rx=sticks.right.x,ry=sticks.right.y;
    for(const gp of navigator.getGamepads?.()??[]){if(!gp)continue;
      gp.buttons.forEach((b,i)=>{if(b.pressed&&PAD[i])buttons|=PAD[i];});
      lx=strongest(lx,axis(gp.axes[0]??0));ly=strongest(ly,-axis(gp.axes[1]??0));rx=strongest(rx,axis(gp.axes[2]??0));ry=strongest(ry,-axis(gp.axes[3]??0));break;
    }
    send(buttons,lx,ly,rx,ry);requestAnimationFrame(poll);
  })();
}
