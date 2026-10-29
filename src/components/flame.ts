// @ts-nocheck
/* Gusteau gas-burner flame mascot: WebGL2 shader with ignition particle streaks. Ported from the standalone chef.js. */
export type FlameState = 'idle' | 'muted' | 'on' | 'speak';
export type FlameHandle = { setState: (s: FlameState) => void; setLevel: (v: number | null) => void; destroy: () => void };

export function mountFlame(canvas: HTMLCanvasElement): FlameHandle | null {
  const gl = canvas.getContext("webgl2", { antialias: false, alpha: false });
  if (!gl) return null;

  const FRAGMENT = `#version 300 es
precision highp float;
out vec4 O;
uniform vec2 uR;uniform float uT,uGG;
uniform vec4 uA,uB,uC,uD,uE,uF,uK0,uK1,uK2,uK3,uEM[32];
uniform vec3 uBG,uSH,uHL,uFL,uMT,uCP;
float hash(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}
float vn(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}
float fbm(vec2 p){return .5*vn(p)+.25*vn(p*2.03+7.)+.125*vn(p*4.1+3.);}
float sdSeg(vec2 p,vec2 a,vec2 b){vec2 pa=p-a,ba=b-a;return length(pa-ba*clamp(dot(pa,ba)/dot(ba,ba),0.,1.));}
float bo(float x){x=clamp(x,0.,1.);float m=x-1.;return 1.+2.70158*m*m*m+1.70158*m*m;}
vec2 port(int i){float a=1.5708-.8975979*float(i);return uK1.w*vec2(cos(a),sin(a));}
vec2 spos(vec2 P0,vec2 dd,float s){float A=clamp(s/.36,0.,1.),B=clamp((s-.36)/.36,0.,1.),m=1.-A;return mix(P0+dd*.42*(1.-m*m*m),vec2(0.,.3),B*B);}
vec4 flame(vec2 q,float H,float W,float sd,float lean,float heat,float amp,vec2 u,float curl,float chub,out float glo){
 glo=0.;if(H<.03||amp<.005)return vec4(0.);
 if(abs(q.x)>W*2.+H*(.6+curl)||q.y>H*1.25||q.y<-H*(.35*curl+.12))return vec4(0.);
 float ph=uK3.z,tt=clamp(q.y/H,0.,1.);
 for(int k=0;k<3;k++){float m=1.-tt;tt=clamp((q.y-u.y*curl*H*tt*m*m)/H,-.1,1.1);}
 float tc=clamp(tt,0.,1.),mm=1.-tc;
 vec2 g=vec2((q.x-u.x*curl*H*.15)/(W*2.5+.12*H),(q.y-H*.4)/(H*.95));glo=amp*exp(-dot(g,g)*1.4);
 float n1=fbm(vec2(tc*2.4-uT*1.8+sd*5.,sd*3.+uT*.3));
 float x=q.x-u.x*curl*H*tc*mm*mm-((n1-.5)*(.18+uK0.z)*W*3.4*tc+lean*H*tc*tc);
 float wo=W*pow(max(1.-tc,0.),.85)*(.45+.55*smoothstep(0.,.22,tc));
 float ee=(tt-.3)/.34,e0=clamp((tt-.3)/.7,0.,1.);
 float wc=W*mix(sqrt(max(1.-ee*ee,0.)),pow(1.-e0,1.35),smoothstep(.28,.32,tt));
 float w=mix(wo,wc,chub);
 float e=(fbm(vec2(x*7.,q.y*5.-uT*3.+sd))-.5)*(.5+.4*ph)*tc;
 float d=abs(x)/max(w,.002)+e;
 float body=smoothstep(1.05,.15,d)*mix(smoothstep(-.06,.03,tt),smoothstep(-.05,-.02,tt),chub);
 float wi=fbm(vec2(x*9.,q.y*2.6-uT*2.6));
 body*=mix(1.,smoothstep(.2+.3*tc,.6+.25*tc,wi+.35),ph*smoothstep(.3,.85,tc));
 float core=smoothstep(.8,0.,d)*(1.-tc*.65),Tm=clamp(core*.95+(1.-tc)*.2,0.,1.);
 vec3 warm=mix(mix(vec3(.9,.27,.04),vec3(1.,.6,.14),smoothstep(0.,.5,Tm)),vec3(1.,.93,.75),smoothstep(.55,1.,Tm));
 vec3 cool=mix(mix(vec3(.1,.22,.9),vec3(.35,.6,1.),smoothstep(0.,.5,Tm)),vec3(.85,.95,1.),smoothstep(.55,1.,Tm));
 float b=clamp(heat+.25*(1.-smoothstep(0.,.25,tc)),0.,1.);
 vec3 c3=mix(warm,cool,b);c3=mix(c3,vec3(.55,.35,.95),ph*.35*smoothstep(.55,1.,d)*(1.-tc*.5));
 float a=pow(body,1.3)*amp*(1.-.2*ph);return vec4(c3*(.8+.7*core)*a,a);}
void main(){
 vec2 p=(gl_FragCoord.xy-.5*uR)/uR.y*3.6;
 float r=length(p),vis=uC.z,SD=uK1.z,gth=uK2.x;
 vec2 L2=normalize(vec2(-.55,.83));vec3 Ld=normalize(vec3(L2*.7,.75));
 float ign=uB.x,lvl=uB.y,sp=uB.z,al=uB.w,pk=1.-clamp(sp/.2,0.,1.);
 vec3 add=vec3(0.);
 vec3 pl=uBG;
 pl=mix(pl,uSH,.6*SD*(1.-smoothstep(-.05,.32,length(p+L2*.12)-1.2)));
 pl=mix(pl,uHL,.5*SD*(1.-smoothstep(-.05,.32,length(p-L2*.12)-1.2)));
 vec3 top=uBG*(1.+.12*dot(p,L2)/1.2);
 top=mix(top,uHL,.5*SD*smoothstep(.04,0.,abs(r-1.185))*(.5+.5*dot(p/max(r,1e-3),L2)));
 pl=mix(pl,top,smoothstep(.012,-.012,r-1.2));
 float wm=smoothstep(.012,-.012,r-.98);
 vec3 wf=uFL*(.9+.25*(1.-r));
 wf*=1.+.18*(vn(vec2(atan(p.y,p.x)*10.,r*45.))-.5);wf*=1.-.3*smoothstep(.018,0.,abs(r-.74));
 for(int k=0;k<4;k++){
  float an=.7854+1.5708*float(k)+uD.z*1.5708;vec2 dv=vec2(cos(an),sin(an));float d0=.17+uK2.y*(1.-uA.w);vec2 a=dv*d0,b=dv*(d0+.36);
  wf=mix(wf,uSH*.3,.55*uA.w*(1.-smoothstep(-.01,.06,sdSeg(p+L2*.05,a,b)-gth)));
  vec2 pa=p-a,ba=b-a,cp=a+ba*clamp(dot(pa,ba)/dot(ba,ba),0.,1.);float d=length(p-cp)-gth;
  vec3 n=normalize(vec3((p-cp)/max(length(p-cp),1e-4)*smoothstep(-gth,0.,d)*.95,1.));
  vec3 bc=vec3(1.)*(.72+.3*dot(n,Ld))+vec3(.15)*pow(max(dot(n,normalize(Ld+vec3(0,0,1))),0.),24.);
  wf=mix(wf,bc,uA.w*smoothstep(.01,-.01,d));}
 wf=mix(wf,uSH*.35,.85*SD*smoothstep(-.03,.1,length(p+L2*.09)-.98));
 wf=mix(wf,uHL*.6,.3*SD*smoothstep(-.03,.1,length(p-L2*.09)-.98));
 pl=mix(pl,wf,wm);
 float cr=.88*uA.y;
 if(cr>.005){
  float o=(.03+.09*(uA.x+.7*uD.x))*(1.-.55*uA.z);
  pl=mix(pl,uSH*.3,.7*wm*(1.-smoothstep(-.02,.12+.1*uA.x,length(p+L2*o)-cr)));
  float sdc=r-cr;vec3 n=normalize(vec3(-p/max(cr,.01)*.3*(1.-.5*uA.z),1.));
  vec3 cc=uCP*(.8+.45*dot(n,Ld))*(1.-.07*uA.z);
  float ndl=dot(p/max(r,1e-3),L2),eg=smoothstep(.05,0.,abs(sdc+.015));
  cc=mix(cc,uHL,.5*eg*max(ndl,0.)*SD);cc=mix(cc,uSH,.4*eg*max(-ndl,0.)*SD);
  pl=mix(pl,cc,smoothstep(.012,-.012,sdc));}
 float gv=max(vis,uF.y),ca=cos(uD.y),sa=-sin(uD.y);
 for(int i=0;i<7;i++){
  float pop=clamp(uD.x*1.6-float(i)*.08,0.,1.);
  vec2 pp=p-mat2(ca,sa,-sa,ca)*port(i)*(1.+.12*uK3.w*pop);
  float l=length(pp),d=l-.045,s=dot(pp/max(l,1e-3),L2);
  pl=mix(pl,uSH*.3,.8*smoothstep(.01,-.01,d)*(.5+.5*s));pl=mix(pl,uHL,.4*smoothstep(.012,0.,abs(d-.004))*max(-s,0.));
  float ig=clamp(ign*1.7-float(i)*.11,0.,1.);
  float pf=.1+.07*sin(uT*1.4+float(i))+ig*mix(.8,.3,sp)+uF.y*(1.-ign)*.9+(i==0?uD.x*.9:0.);
  pf*=1.-.85*smoothstep(0.,.15,sp)*(1.-smoothstep(.72,.9,sp));
  add+=vec3(1.,.55,.2)*exp(-dot(pp,pp)/.0012)*pf*gv;}
 vec3 col=mix(uBG,pl,vis);
 if(uF.z>.01){float y01=clamp((p.y-.5*uK2.z)/1.4,0.,1.);
  float env=exp(-p.x*p.x/(.1+.55*y01))*smoothstep(.15,.6,p.y)*smoothstep(2.1,1.2,p.y);
  col=mix(col,mix(vec3(.5),vec3(.95,.6,.4),.25),.42*smoothstep(.4,.75,fbm(vec2(p.x*2.4,p.y*1.7-uT*.6)+5.))*env*uF.z);}
 vec3 fire=vec3(0.);float fa=0.,glo=0.,heat=clamp(lvl*uK1.x*1.25,0.,1.);
 for(int i=0;i<7;i++){
  vec2 P0=port(i);
  float ig=smoothstep(0.,1.,clamp(ign*1.7-float(i)*.11,0.,1.)),amp=ig*pk*(1.-clamp(uC.w/1.2,0.,1.));
  if(amp<.01)continue;
  float ph=float(i)*1.9,fl=.88+.12*sin(uT*(5.+float(i%3))+ph)*sin(uT*3.1+ph*2.);
  float H=uK0.x*(.55+.95*lvl)*fl*(.8+.25*hash(vec2(float(i),3.)))*(1.+uC.w*.8),W=uK0.y*(.9+.5*lvl);
  float g;vec4 f=flame(p-P0-vec2(0.,.02+uC.w*.9),H,W,float(i),uK0.w*lvl*.5+.05*sin(uT*.8+ph)*uK0.z,heat,amp,normalize(P0),uK3.x*(1.+.12*sin(uT*1.7+ph)),0.,g);
  fire+=f.rgb;fa=1.-(1.-fa)*(1.-f.a);glo+=g;}
 float c=clamp((sp-.72)/.28,0.,1.);
 if(c>0.&&uC.x>.01){
  float s=bo(c)*uK2.z,H=1.3*s*(1.+al*.1+.03*sin(uT*2.3)),W=.4*s*(1.+al*.12),by=.02;
  float g;vec4 f=flame(p-vec2(0.,by-(1.-uC.y)*H*.95),H,W,9.5,.12*sin(uT*.9)+.1*al*sin(uT*7.)+.1,0.,uC.x*smoothstep(0.,.3,c)*smoothstep(by-.09,by-.03,p.y),vec2(0.),0.,uK3.y,g);
  fire+=f.rgb;fa=1.-(1.-fa)*(1.-f.a);glo+=g*1.4;}
 if(uE.x>.01){
  float ms=uK2.z,m=uE.w;vec2 q=p-vec2(0.,.66*ms+uE.y);
  float an=uD.w*exp(-dot(q,q)*1.6),cn=cos(an),sn=sin(an);q=mat2(cn,sn,-sn,cn)*q;
  vec2 wq=q*2.6+vec2(0.,-uT*1.2);q+=(vec2(fbm(wq),fbm(wq+9.))-.5)*uF.w*(.35+.65*smoothstep(-.5,.5,q.y));
  q.y/=1.+uE.z*1.4;q/=ms*.95;
  vec2 A=vec2(0.,-.06),B=vec2(0.,mix(.15,.5,bo(m))),pa=q-A,ba=B-A;float hh=clamp(dot(pa,ba)/dot(ba,ba),0.,1.);
  float sdS=length(pa-ba*hh)-mix(.05,.115,hh);
  float sdD=length(q-vec2(0.,-.06-.26*bo((m-.3)/.7)+.015*sin(uT*3.)))-.08*clamp(m*3.,0.,1.);
  float sd=min(sdS,sdD)*ms*.95,stk=fbm(vec2(q.x*10.,q.y*2.2-uT*2.4));
  float body=smoothstep(.03,-.09,sd)*(.55+.45*stk)+exp(-max(sd,0.)*7.)*.3*stk;
  vec3 gc=mix(vec3(.95,.3,.05),vec3(1.,.85,.5),smoothstep(0.,-.12,sd));gc=mix(gc,vec3(.55,.35,.95),.3*smoothstep(0.,.15,sd));
  float dn=fbm(q*3.+3.)-q.y*.25+.35,dis=uE.z*1.5-.1,keep=smoothstep(dis,dis+.12,dn);
  gc+=vec3(1.,.55,.15)*smoothstep(dis+.25,dis,dn)*keep;
  float a2=clamp(body,0.,1.)*keep*uE.x;fire+=gc*a2;fa=1.-(1.-fa)*(1.-a2*.8);glo+=a2*.7;}
 col+=vec3(1.,.42,.14)*(ign*pk*(.35+.65*lvl)*.5+c*uC.x*.8+uE.x*.6)*uK1.y*.14*uGG*exp(-r*r*.6)*vis;
 col=col*(1.-fa*(1.-.35*uK3.z))+fire;
 col+=mix(vec3(1.,.4,.1),vec3(.3,.5,1.),heat)*glo*uK1.y*.35*uGG;
 if(sp>.001&&sp<.999){float b=clamp((sp-.36)/.36,0.,1.),fl=clamp((sp-.72)/.28,0.,1.);vec2 tg=vec2(0.,.3),dt=p-tg;
  if(b<1.)for(int i=0;i<7;i++){vec2 P0=port(i),dd=normalize(P0),h=spos(P0,dd,sp),tl=spos(P0,dd,max(0.,sp-.16)),pa=p-tl,ba=h-tl;
   float t=clamp(dot(pa,ba)/max(dot(ba,ba),1e-5),0.,1.),d=sdSeg(p,tl,h),wd=.004+.02*t;
   add+=(vec3(1.,.5,.2)*exp(-d*d/(wd*wd*6.))*t*.9+vec3(1.,.85,.6)*exp(-d*d/(wd*wd*.8))*t+vec3(1.,.95,.85)*exp(-dot(p-h,p-h)/.0012)*1.1)*uGG;}
  add+=(vec3(1.,.85,.6)*exp(-dot(dt,dt)/(.003+.025*b*b))*b*(1.-fl)*1.4+vec3(1.,.4,.1)*exp(-dot(dt,dt)/(.08+.3*b))*b*(1.-fl)*.5+vec3(1.,.8,.5)*exp(-dot(dt,dt)/(.1+.8*fl))*fl*(1.-fl)*3.)*uGG;}
 float em=0.;for(int i=0;i<32;i++){vec4 e=uEM[i];vec2 d=p-e.xy;em+=e.w*exp(-dot(d,d)/(e.z*e.z));}
 add+=vec3(1.,.55,.22)*em*.9*uGG;
 col+=add;
 col+=(hash(gl_FragCoord.xy+fract(uT))-.5)/255.;
 O=vec4(clamp(col,0.,1.),1.);}`;

  /* Ignition streaks: the radial jet particles from the original chef flame, one fan per burner port. */
  const STREAK_VERT = `#version 300 es
in vec3 aP;
uniform float uTb,uStep,uAsp,uDpr,uSz;
uniform float uRing;
out float vAge;out vec2 vDir;out float vSeed;
void main(){
 float port=aP.x,s=aP.y,sd=aP.z;
 float delay=port*uStep+sd*.16;
 float life=.7+.5*sd;
 float a=clamp((uTb-delay)/life,0.,1.);
 vAge=a;vSeed=sd;
 float ang=1.5708-.8975979*port;
 vec2 out_=vec2(cos(ang),sin(ang)),side=vec2(-out_.y,out_.x);
 float spread=(s-.5)*.55;
 vec2 dir=normalize(out_+side*spread);
 float reach=(.28+.42*sd)*(1.-(1.-a)*(1.-a));
 float rise=(.35+.8*sd)*a*a;
 vec2 p=out_*uRing+dir*reach+vec2(0.,rise);
 p.x+=sin(a*9.+sd*31.)*.012*a;
 vec2 v=dir*(.28+.42*sd)*2.*(1.-a)+vec2(0.,(.35+.8*sd)*2.*a);
 vDir=normalize(vec2(v.x,v.y)+1e-4);
 gl_Position=vec4(p.x*2./(3.6*uAsp),2.*p.y/3.6,0.,1.);
 gl_PointSize=a<=0.||a>=1.?0.:uSz*uDpr*(.7+.5*sd)*(1.-.35*a);
}`;
  const STREAK_FRAG = `#version 300 es
precision mediump float;
in float vAge;in vec2 vDir;in float vSeed;
out vec4 O;
void main(){
 vec2 c=gl_PointCoord-.5;c.y=-c.y;
 float along=dot(c,vDir)+.5,across=dot(c,vec2(-vDir.y,vDir.x));
 float w=mix(.1,.03,smoothstep(0.,.85,vAge))*(1.-smoothstep(.55,1.,along)*.85);
 float streak=1.-smoothstep(w,w+.02,abs(across));
 float ends=smoothstep(.02,.45,along)*(1.-smoothstep(.9,1.,along));
 float life=smoothstep(0.,.1,vAge)*(1.-smoothstep(.55,1.,vAge));
 vec3 hot=vec3(1.,.55,.18),cool=vec3(.2,.3,.95);
 vec3 col=mix(hot,cool,smoothstep(.15,.85,vAge));
 col=mix(col,vec3(1.,.95,.8),smoothstep(.6,1.,along)*(1.-vAge)*.7);
 float al=streak*ends*life*(.75+.25*vSeed);
 if(al<.004)discard;
 O=vec4(col,al);
}`;
  const VERT = `#version 300 es
void main(){vec2 v=vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2));gl_Position=vec4(v*2.-1.,0.,1.);}`;

  const compile = (type, src) => {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, src);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
    return shader;
  };
  const link = (vs, fs) => {
    const program = gl.createProgram();
    gl.attachShader(program, compile(gl.VERTEX_SHADER, vs));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
    return program;
  };
  let main, streak;
  try {
    main = link(VERT, FRAGMENT);
    streak = link(STREAK_VERT, STREAK_FRAG);
  } catch (error) {
    console.error("Gusteau flame failed to start", error);
    return null;
  }
  const locs = new Map();
  const loc = (program, name) => {
    const key = program === main ? `m${name}` : `s${name}`;
    if (!locs.has(key)) locs.set(key, gl.getUniformLocation(program, name));
    return locs.get(key);
  };
  const Um = (name, ...v) => gl[`uniform${v.length}f`](loc(main, name), ...v);
  const Us = (name, ...v) => gl[`uniform${v.length}f`](loc(streak, name), ...v);

  const PORTS = 7, STRANDS = 7;
  const streakData = [];
  for (let p = 0; p < PORTS; p += 1) {
    for (let s = 0; s < STRANDS; s += 1) {
      streakData.push(p, s / (STRANDS - 1), (s * 0.618034 + p * 0.37) % 1);
    }
  }
  const streakCount = streakData.length / 3;
  const streakBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, streakBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(streakData), gl.STATIC_DRAW);
  const streakVao = gl.createVertexArray();
  gl.bindVertexArray(streakVao);
  const aP = gl.getAttribLocation(streak, "aP");
  gl.enableVertexAttribArray(aP);
  gl.vertexAttribPointer(aP, 3, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);

  const $ = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const eo = (x) => 1 - (1 - x) ** 3;
  const bo = (x) => { x = $(x); return 1 + 2.70158 * (x - 1) ** 3 + 1.70158 * (x - 1) ** 2; };
  const sm3 = (x) => { x = $(x); return x * x * (3 - 2 * x); };
  const mv = (a, b, d) => (a < b ? Math.min(a + d, b) : Math.max(a - d, b));

  const THEME = { bg: [.90, .88, .84], sh: [.70, .67, .62], hl: [1, .99, .96], fl: [.17, .155, .145], mt: [.62, .59, .55], cp: [.93, .91, .87], gg: .45 };
  const P = { sh: .63, ring: .56, gth: .14, slide: 1.03, press: 1, fH: 1, fW: .25, curl: .9, phantom: .6, flick: .05, wind: 0, blue: 2, glow: .2, embers: 2, sens: 3.75, manual: .08, mSize: 1, chub: .8, warp: 1, dialPop: .6, speed: 1.95, hold: 1 };
  const TG = { idle: { cap: 1, gr: 0, ign: 0, sp: 0 }, muted: { cap: 0, gr: 1, ign: 0, sp: 0 }, on: { cap: 0, gr: 0, ign: 1, sp: 0 }, speak: { cap: 0, gr: 0, ign: 1, sp: 1 }, notice: { cap: 0, gr: 0, ign: 1, sp: 1 } };
  const ST = { cap: 1, iris: 1, gr: 0, ign: 0, sp: 0, lvl: 0, al: 0, dial: 1 };
  const press = { x: 0, v: 0 };
  const EM = [];
  const EMB = new Float32Array(128);
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");
  let level = null, raf = 0, dead = false;
  let state = "idle", pend = null, pendN = 0, NT = 0, T = 0, last = 0, down = 0;
  let burstStart = -1, W = 1, H = 1, dpr = 1, visible = true;

  const port = (i) => { const a = Math.PI / 2 - .8975979 * i; return [P.ring * Math.cos(a), P.ring * Math.sin(a)]; };
  const sim = (t) => $(Math.pow(Math.sin(t * .9) * .5 + .5, 1.5) * (.6 + .4 * Math.sin(t * 9.1) * Math.sin(t * 5.3)) * 1.2);
  const agent = (t) => $(.15 + .85 * Math.abs(Math.sin(t * 3.7) * Math.sin(t * 1.3 + 1)) + .2 * Math.sin(t * 23));

  function apply(next) {
    state = next;
    if (next === "notice") NT = 0;
  }
  function setState(next) {
    pendN = 0;
    if (next === "notice" && state !== "speak" && state !== "notice") { pendN = 1; next = "speak"; }
    if (next === state && !pend) return;
    if (ST.dial >= 1 && next !== state && !reduceMotion.matches) { pend = next; ST.dial = 0; } else apply(next);
  }

  function noticeTimeline() {
    if (state !== "notice") return { ph: 0, m: 0, v: 0, r: 1 };
    const a = .85, b = P.hold, c = 1.2, d = 1, n = NT;
    if (n < a) return { ph: 0, m: n / a, v: 0, r: 1 };
    if (n < a + b) return { ph: 1, m: 1, v: 0, r: 1 };
    if (n < a + b + c) return { ph: 2, m: 1, v: (n - a - b) / c, r: 1 };
    return { ph: 3, m: 0, v: 1, r: $((n - a - b - c) / d) };
  }

  function ember(x, y) {
    if (EM.length < 32) EM.push({ x, y, vx: (Math.random() - .5) * .25, vy: .2 + Math.random() * .35, l: 0, m: .8 + Math.random() * 1.1, s: .012 + Math.random() * .012, id: Math.random() * 9 });
  }

  function update(dt) {
    const k = dt * P.speed, tg = TG[state], S = ST;
    if (S.dial < 1) {
      S.dial = Math.min(1, S.dial + k / 1.15);
      if (pend && S.dial > .45) { apply(pend); pend = null; }
    }
    const closed = S.gr < .15 && S.ign < .15 && S.sp < .1;
    if (tg.cap) { S.iris = mv(S.iris, closed ? 1 : 0, k * 3); S.cap = mv(S.cap, S.iris > .85 ? 1 : 0, k * 3); }
    else { S.cap = mv(S.cap, 0, k * 3); S.iris = mv(S.iris, S.cap < .2 ? 0 : 1, k * 3); }
    S.gr = mv(S.gr, tg.gr && S.iris < .3 ? 1 : 0, k * 1.5);
    const open = S.iris < .3 && (tg.gr || S.gr < .05);
    const prevIgn = S.ign;
    S.ign = mv(S.ign, tg.ign && open ? 1 : 0, k * 1.4);
    S.sp = mv(S.sp, tg.sp && S.ign > .75 ? 1 : 0, k / 1.5);
    if (prevIgn < .02 && S.ign >= .02) burstStart = T;
    if (S.ign < .02) burstStart = -1;
    const raw = level === null ? Math.max(sim(T), P.manual) : $(level * 1.6);
    const target = state === "on" ? raw : 0;
    S.lvl += (target - S.lvl) * (1 - Math.exp(-dt * (target > S.lvl ? 16 : 3.2)));
    const at = state === "speak" || state === "notice" ? agent(T) : 0;
    S.al += (at - S.al) * (1 - Math.exp(-dt * (at > S.al ? 14 : 5)));
    for (let i = 0; i < 2; i += 1) {
      const h = dt / 2;
      press.v += (300 * (down ? 1 : 0) - 300 * press.x - 26 * press.v) * h;
      press.x += press.v * h;
    }
    if (pendN && S.sp > .99 && state === "speak") { pendN = 0; apply("notice"); }
    if (state === "notice") { NT += k; if (NT >= .85 + P.hold + 2.2) apply("speak"); }
    let n = dt * P.embers * (S.ign * (1 - S.sp) * (4 + S.lvl * 20) + (S.sp > .9 ? 6 + S.al * 16 : 0));
    n = Math.floor(n) + (Math.random() < n % 1 ? 1 : 0);
    while (n--) {
      if (S.sp > .9) ember((Math.random() - .5) * .25, .02 + 1.2 * P.mSize * (.6 + Math.random() * .3));
      else { const p = port(Math.random() * 7 | 0); ember(p[0], p[1] + P.fH * (.6 + Math.random() * .5)); }
    }
    for (let i = EM.length; i--;) {
      const e = EM[i];
      e.l += dt;
      if (e.l > e.m) { EM.splice(i, 1); continue; }
      e.vy += .35 * dt;
      e.vx += (P.wind * S.lvl * 1.4 + .12 * Math.sin(T * 2.1 + e.y * 5 + e.id)) * dt;
      e.vx *= Math.exp(-dt * 1.1);
      e.vy *= Math.exp(-dt * .6);
      e.x += e.vx * dt;
      e.y += e.vy * dt;
    }
  }

  function resize() {
    const r = canvas.getBoundingClientRect();
    dpr = Math.min(devicePixelRatio || 1, 2);
    W = canvas.width = Math.max(2, Math.round(r.width * dpr));
    H = canvas.height = Math.max(2, Math.round(r.height * dpr));
  }

  function render() {
    const S = ST, N = noticeTimeline(), t = THEME;
    const ph = N.ph;
    const fv = ph === 0 ? 1 - N.m : ph === 3 ? 1 : 0;
    const bA = ph === 0 ? sm3(N.m * 1.6) : ph === 3 ? 0 : 1;
    const smk = ph === 2 ? Math.min(1, N.v * 2) : ph === 3 ? 1 - N.r : 0;
    const lift = ph === 2 ? eo(N.v) : ph === 1 ? .03 * Math.sin(T * 3) : 0;
    const tw = ph === 0 ? (1 - N.m) * 2.6 : ph === 2 ? -3 * eo(N.v) : 0;
    const warp = P.warp * (ph === 0 ? .5 * (1 - N.m) + .15 : ph === 1 ? .12 + .05 * Math.sin(T * 2) : ph === 2 ? .15 + 1.1 * N.v : 0);
    const d = S.dial, dk = bo(d < 1 ? (d - .25) / .3 : 0);

    gl.viewport(0, 0, W, H);
    gl.disable(gl.BLEND);
    gl.useProgram(main);
    Um("uR", W, H); Um("uT", T); Um("uGG", t.gg);
    Um("uA", sm3(S.cap), sm3(S.iris), press.x * P.press, sm3(S.gr));
    Um("uB", sm3(S.ign), S.lvl, S.sp, S.al);
    Um("uC", fv, eo(N.r), 1, 0);
    Um("uD", d < 1 ? Math.sin(Math.PI * d) : 0, d < 1 ? dk * 2 * Math.PI / 7 : 0, d < 1 ? dk : 0, tw);
    Um("uE", bA, lift, ph === 2 ? N.v : 0, ph === 0 ? N.m : 1);
    Um("uF", 0, 0, smk, warp);
    Um("uK0", P.fH, P.fW, P.flick, P.wind);
    Um("uK1", P.blue, P.glow, P.sh, P.ring);
    Um("uK2", P.gth, P.slide, P.mSize, 0);
    Um("uK3", P.curl, P.chub, P.phantom, P.dialPop);
    Um("uBG", ...t.bg); Um("uSH", ...t.sh); Um("uHL", ...t.hl); Um("uFL", ...t.fl); Um("uMT", ...t.mt); Um("uCP", ...t.cp);
    EMB.fill(0);
    EM.forEach((e, i) => {
      const k = 1 - e.l / e.m;
      EMB.set([e.x, e.y, e.s * (.6 + .6 * k), k * k * (.6 + .4 * Math.sin(e.l * 40 + e.id * 7))], i * 4);
    });
    gl.uniform4fv(loc(main, "uEM"), EMB);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    const tb = burstStart < 0 ? -1 : T - burstStart;
    if (tb >= 0 && tb < 2.4) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.useProgram(streak);
      Us("uTb", tb);
      Us("uStep", .11 / (1.7 * 1.4 * P.speed));
      Us("uAsp", W / H);
      Us("uDpr", dpr);
      Us("uSz", 34);
      Us("uRing", P.ring);
      gl.bindVertexArray(streakVao);
      gl.drawArrays(gl.POINTS, 0, streakCount);
      gl.bindVertexArray(null);
    }
  }

  function frame(ts) {
    if (dead) return;
    const dt = Math.min(.05, (ts - last) / 1000 || 0);
    last = ts;
    if (visible) {
      T += dt;
      update(dt);
      render();
    }
    raf = requestAnimationFrame(frame);
  }

  const resizeObs = new ResizeObserver(resize);
  resizeObs.observe(canvas);
  resize();
  const visObs = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; });
  visObs.observe(canvas);
  raf = requestAnimationFrame(frame);

  return {
    setState,
    setLevel: (v) => { level = v; },
    destroy: () => {
      dead = true;
      cancelAnimationFrame(raf);
      resizeObs.disconnect();
      visObs.disconnect();
    },
  };
}
