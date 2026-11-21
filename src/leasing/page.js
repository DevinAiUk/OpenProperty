const labels=['Overview','Listings','Leads','Calendar','Financials','Settings'];
export function leasingPage(path){
  const demo=path.endsWith('/demo');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#172b2b"><meta name="robots" content="noindex"><title>Landlord workspace · SiLL</title><link rel="icon" href="/assets/sill.png"><link rel="stylesheet" href="/leasing.css"></head><body class="leasing" data-mode="${demo?'demo':'live'}">
  <div class="layout"><aside class="sidebar"><a class="brand" href="/"><img src="/assets/sill.png" alt="SiLL"><span>Super Intel<br>LandLord</span></a>
  <div class="space-mode">${demo?'Demo portfolio':'Landlord workspace'}</div><nav aria-label="Landlord sections">${labels.map(n=>`<a href="#${n.toLowerCase()}">${n}</a>`).join('')}</nav>
  <footer><a class="back" href="/portal">Resident portal</a><a class="back" href="${demo?'/leasing':'/leasing/demo'}">${demo?'Open my workspace':'Explore the demo'}</a></footer></aside>
  <main class="main"><header class="top"><div><div class="eyeline" id="portfolio-name">${demo?'Sample portfolio':'Property management'}</div><h1 id="title">Overview</h1><p class="sub" id="subtitle"></p></div><div class="top-actions" id="top-actions"></div></header>
  <div class="notice" id="message" role="status" hidden></div><section class="body" id="content" aria-live="polite"><p>Opening your workspace…</p></section></main></div>
  <dialog id="dialog"><div class="dialog-head"><h2 id="dialog-title"></h2><button class="btn small secondary" id="close-dialog" type="button">Close</button></div><div id="dialog-body"></div><p id="dialog-error" role="alert"></p></dialog>
  <noscript>This workspace needs JavaScript for calendar availability and financial calculations.</noscript><script type="module" src="/leasing.js"></script></body></html>`;
}
