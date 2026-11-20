const $ = id => document.getElementById(id);
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const safeLink = raw => {try {const url = new URL(raw); return ['http:','https:'].includes(url.protocol) ? url.href : '';} catch {return '';}};
const date = value => value ? new Date(value).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}) : '未知';
const tabs = ['搜岗总览','搜索计划','搜岗批次','岗位结果','素材与能力','筛选逻辑'];
const dimensions = ['人群与需求判断','渠道获客','触达与资源分配','转化与销售承接','数据与商业回收','项目协作与交付'];
let state = {jobs:[],runs:[],plans:[],evidence:[]}, tab = tabs[0];
let filter = '';

async function api(path, data) {
  const response = await fetch(path, data ? {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)} : {});
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || '请求失败');
  return result;
}
async function refresh() {
  try {state = await api('/api/state'); render();} catch (error) {$('notice').textContent = error.message;}
}
function panel(title, body) {return `<section class="panel"><h2>${escapeHtml(title)}</h2>${body}</section>`;}
function empty(message) {return `<p class="empty">${escapeHtml(message)}</p>`;}
function table(headings, rows) {return `<div class="scroll"><table><thead><tr>${headings.map(h=>`<th>${escapeHtml(h)}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`;}
function runName(id) {const run=state.runs.find(r=>r.id===id); return run ? `${run.source} · ${run.keyword} · ${run.city}` : id;}
function jobList() {
  const jobs = state.jobs.filter(j=>[j.title,j.company,j.status,...(j.runIds||[]).map(runName)].join(' ').toLowerCase().includes(filter.toLowerCase())).sort((a,b)=> {
    const done = s => ['已投递','跳过','不匹配'].includes(s) ? 1 : 0;
    return done(a.status)-done(b.status) || new Date(b.firstSeen)-new Date(a.firstSeen);
  });
  return `<input id="job-filter" aria-label="筛选岗位" placeholder="搜索公司、岗位、搜索词或状态" value="${escapeHtml(filter)}">` + (jobs.length ? table(['公司与岗位','来源与搜索词','匹配判断','跟进'],jobs.map(j=> {
    const url = safeLink(j.url), review = j.review;
    return `<tr><td><strong>${escapeHtml(j.company)}</strong><br>${escapeHtml(j.title)}<p class="muted">${escapeHtml(j.city)} · ${escapeHtml(j.salary||'薪资未知')}</p>${url?`<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">打开原岗位</a>`:''}<details><summary>JD 与核验信息</summary><pre>${escapeHtml(j.jd)}</pre><p>首次发布 ${escapeHtml(j.postedAt||'未知')}</p><p>${escapeHtml(j.dateEvidence||'尚无日期核验记录')}</p><p>首次入库 ${date(j.firstSeen)}</p></details></td>
    <td>${(j.runIds||[]).map(r=>`<p>${escapeHtml(runName(r))}</p>`).join('')}</td>
    <td><span class="chip">${escapeHtml(review?.verdict||j.reviewState||'待评估')}</span><p>${escapeHtml(review?.strength||'等待逐项经历证据匹配')}</p><details><summary>要求与证据</summary>${(review?.mapping||[]).map(m=>`<p>${m.map(escapeHtml).join(' · ')}</p>`).join('')}<p>${escapeHtml(review?.gaps||'')}</p></details></td>
    <td><select class="status" data-status="${escapeHtml(j.id)}" aria-label="${escapeHtml(j.title)}跟进状态">${['待评估','待跟进','已沟通','已投递','不匹配','跳过'].map(s=>`<option${s===j.status?' selected':''}>${s}</option>`).join('')}</select><p>${escapeHtml(j.reason||'')}</p>${j.appliedAt?`<p class="muted">投递 ${date(j.appliedAt)}</p>`:''}</td></tr>`;
  })) : empty('还没有岗位结果。请在搜岗批次导入已读取的真实 JD，或载入虚构示例体验流程。'));
}
function render() {
  $('heading').textContent=tab;
  document.querySelector('nav').innerHTML=tabs.map(t=>`<button data-tab="${t}" class="${t===tab?'active':''}">${t}</button>`).join('');
  const today = new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const appliedToday = state.jobs.filter(j=>j.status==='已投递' && j.appliedAt && new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(j.appliedAt))===today).length;
  $('stats').innerHTML=[[state.plans.length,'搜索计划'],[state.runs.length,'搜岗批次'],[state.jobs.length,'去重岗位'],[appliedToday,'今日标记已投递']].map(([n,l])=>`<div class="stat"><strong>${n}</strong><span>${l}</span></div>`).join('');
  if(tab==='搜岗总览') $('content').innerHTML=panel('本轮进度',`<div class="flow"><span>计划</span><span>采集与详情核验</span><span>去重</span><span>硬筛</span><span>证据匹配</span><span>跟进</span></div><p>从每条岗位可追溯到搜索词与搜岗批次，匹配结论可追溯到 JD 要求及个人证据。</p><div class="alert">浏览器自动采集尚未接入。当前支持批次 JSON 导入、自动去重、逐项评估展示和跟进留档。</div><div class="grid"><div><h3>最近批次</h3>${state.runs.slice().sort((a,b)=>new Date(b.recordedAt)-new Date(a.recordedAt)).slice(0,4).map(r=>`<p>${escapeHtml(r.keyword)} · ${escapeHtml(r.source)} <span class="chip">${escapeHtml(r.state)}</span><br><span class="muted">${escapeHtml(r.blocker||'')} · 读取${r.readCount}条</span></p>`).join('')||empty('尚无搜岗批次')}</div><div><h3>需要跟进</h3>${state.jobs.filter(j=>['待跟进','已沟通'].includes(j.status)).slice(0,5).map(j=>`<p>${escapeHtml(j.company)} · ${escapeHtml(j.title)}</p>`).join('')||empty('尚无待跟进记录')}</div></div>`);
  if(tab==='搜索计划') $('content').innerHTML=panel('搜索词列表',state.plans.length?table(['关键词','来源与城市','经历依据','执行'],state.plans.map(p=>`<tr><td>${escapeHtml(p.keyword)}</td><td>${escapeHtml(p.source)} · ${escapeHtml(p.city)}</td><td>${escapeHtml(p.basis)}</td><td>等待采集器接入</td></tr>`)):empty('添加关键词及对应经历依据，供浏览器采集器按计划执行。'))+panel('添加搜索计划',`<form id="plan-form"><div class="grid"><div><label>关键词<input name="keyword" required placeholder="例如：触达运营"></label><label>来源<input name="source" required placeholder="例如：BOSS直聘"></label></div><div><label>城市<input name="city" required placeholder="北京或上海"></label><label>对应经历依据<input name="basis" required placeholder="引用素材库里的具体项目与行动"></label></div></div><button>保存计划</button></form>`);
  if(tab==='搜岗批次') $('content').innerHTML=panel('执行记录',state.runs.length?table(['来源与城市','关键词','执行结果','读取与去重结果'],state.runs.map(r=>`<tr><td>${escapeHtml(r.source)} · ${escapeHtml(r.city)}</td><td>${escapeHtml(r.keyword)}</td><td>${escapeHtml(r.state)}<p>${escapeHtml(r.blocker||'')}</p><span class="muted">${date(r.recordedAt)}</span></td><td>本批读取 ${r.readCount} 条<p>关联 ${state.jobs.filter(j=>(j.runIds||[]).includes(r.id)).length} 个去重岗位</p></td></tr>`)):empty('运行失败也应导入一条批次记录，写明登录、验证码或连接阻塞。'))+panel('导入采集结果',`<p>上传符合 <a href="/example.json" target="_blank">example.json</a> 的 JSON。导入回执显示新增与更新数量。</p><input id="import" type="file" accept=".json,application/json" aria-label="导入采集结果"><p><button id="demo">载入虚构示例</button></p><span class="muted">示例公司、JD 和能力材料用于功能演示。</span>`);
  if(tab==='岗位结果') $('content').innerHTML=panel('岗位与匹配',jobList());
  if(tab==='素材与能力') $('content').innerHTML=panel('能力维度',`<div class="flow">${dimensions.map(d=>`<span>${d}</span>`).join('')}</div><p>每条证据记录本人行动、来源和职责边界。匹配时使用“直接证据 / 可迁移证据 / 已确认不满足 / 信息未知”，不将未知自动记为满足或不满足。</p>`)+panel('个人素材库',state.evidence.length?state.evidence.map(e=>`<article><h3>${escapeHtml(e.title)} <span class="chip">${escapeHtml(e.dimension)}</span></h3><p>${escapeHtml(e.action)}</p><p class="muted">来源 ${escapeHtml(e.source)} · 边界 ${escapeHtml(e.boundary)}</p></article>`).join(''):empty('尚无个人材料。示例材料须由你替换成已核实经历。'))+panel('添加已核实证据',`<form id="evidence-form"><label>项目名称<input name="title" required></label><label>能力维度<select name="dimension">${dimensions.map(d=>`<option>${d}</option>`).join('')}</select></label><label>本人实际行动<textarea name="action" required></textarea></label><label>来源文件或本人确认记录<input name="source" required></label><label>职责与指标边界<input name="boundary" required></label><button>保存证据</button></form>`);
  if(tab==='筛选逻辑') $('content').innerHTML=panel('从搜索到推荐',`<ol><li><p>根据已核实素材生成搜索计划。每个词写明为什么搜、对应哪段经历。</p></li><li><p>逐来源读取推荐列表和关键词列表，再打开原始 JD。记录招聘状态、薪资、日期及 HR 活跃。刷新日与首次发布日分别记录。</p></li><li><p>按岗位规范化 URL 去重，保留全部命中批次。已投递、跳过和不匹配记录继续保留。</p></li><li><p>先执行地点、薪资、行业、规模和外包等硬条件，再看实际职责。名称与类型正则只负责发现候选。</p></li><li><p>逐项拆解核心职责、必备条件和加分项，引用证据库来源。展示直接相关经历、关键缺口与未知项，不把加分项当硬门槛。</p></li><li><p>写入匹配评估后回读核对。JD 变化时旧评估失效。对用户标记不匹配的记录保存原因，原因未确认时不自动扩大排除范围。</p></li></ol>`)+panel('自动化与当前边界',`<p>已实现批次导入、去重、命中词追踪、状态与历史持久化、投递日期统计、证据库、JSON 导出及评估展示。</p><p>浏览器连接、登录检测、定时调度、JD 自动解析、证据评估生成、连接版私人工作台双向同步仍待接入。采集器通过 POST /api/import 写入本机；Chrome 登录和验证码由用户处理。</p><p>当前原型不执行自动打招呼或投递。显示的“今日标记已投递”来自工作台状态记录，平台实际投递结果需要单独同步。</p>`);
}

document.querySelector('nav').addEventListener('click',e=>{if(e.target.dataset.tab){tab=e.target.dataset.tab;render();}});
$('refresh').onclick=refresh;
$('export').onclick=()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(state,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='workbench-backup.json';a.click();URL.revokeObjectURL(url);};
$('content').addEventListener('input',e=>{if(e.target.id==='job-filter'){filter=e.target.value;const position=e.target.selectionStart;render();$('job-filter').focus();$('job-filter').setSelectionRange(position,position);}});
$('content').addEventListener('change',async e=>{
  try {
    if(e.target.id==='import' && e.target.files[0]) {const result=await api('/api/import',JSON.parse(await e.target.files[0].text()));await refresh();$('notice').textContent=`导入成功 · 新增 ${result.inserted} · 更新 ${result.updated}`;}
    if(e.target.dataset.status) {const job=state.jobs.find(j=>j.id===e.target.dataset.status);let reason=job.reason||'';if(e.target.value==='不匹配')reason=prompt('不匹配的具体原因（可以暂留空，后续核对）',reason)??reason;await api('/api/decision',{id:job.id,status:e.target.value,reason});await refresh();}
  } catch(error){$('notice').textContent=error.message;}
});
$('content').addEventListener('submit',async e=>{
  e.preventDefault();
  try {const kind=e.target.id==='plan-form'?'plans':'evidence';const item=Object.fromEntries(new FormData(e.target));item.id=crypto.randomUUID();await api('/api/material',{kind,item});await refresh();$('notice').textContent='已保存';}catch(error){$('notice').textContent=error.message;}
});
$('content').addEventListener('click',async e=>{
  if(e.target.id!=='demo')return;
  try {const example=await (await fetch('/example.json')).json();for(const [kind,items] of [['plans',example.plans],['evidence',example.evidence]])for(const item of items)await api('/api/material',{kind,item});const result=await api('/api/import',example);await refresh();$('notice').textContent=`虚构示例已载入 · 新增 ${result.inserted} · 更新 ${result.updated}`;}catch(error){$('notice').textContent=error.message;}
});
refresh();
