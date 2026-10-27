import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

// Execute the actual production site's pricing/calculator code with a small DOM.
export async function createPublicRatesBrowser(fetchImpl) {
  class Element {
    children = [];
    listeners = {};
    value = '';
    textContent = '';
    attributes = {};
    constructor(tag = 'div') { this.tag = tag; }
    setAttribute(name, value) { this.attributes[name] = value; }
    replaceChildren(...children) {
      this.children = children;
      if (this.tag === 'select') this.value = (children.find(child => child.selected) || children[0])?.value || '';
    }
    append(...children) { this.children.push(...children); }
    addEventListener(type, callback) { (this.listeners[type] ||= []).push(callback); }
    async emit(type) { await Promise.all((this.listeners[type] || []).map(callback => callback())); }
  }
  const elements = Object.fromEntries(['estimate-metal', 'estimate-purity', 'estimate-grams', 'estimate-total', 'estimate-breakdown', 'estimate-error', 'rates-status', 'rates-age-note']
    .map(id => [`#${id}`, new Element(id === 'estimate-purity' ? 'select' : 'div')]));
  elements['#estimate-metal'].value = 'Gold';
  for (const metal of ['Gold', 'Silver', 'Platinum']) elements[`[data-rate-table="${metal}"]`] = new Element();
  const document = Object.assign(new Element(), { body: { dataset: {} }, hidden: false, createElement: tag => new Element(tag) });
  const window = new Element();
  const intervals = [], timeouts = new Set(), requests = [];
  const context = vm.createContext({
    document, window, AbortController, console,
    $: selector => elements[selector],
    setInterval: (callback, delay) => { intervals.push({ callback, delay }); return intervals.length; },
    setTimeout: (callback, delay) => { const timer = { callback, delay }; timeouts.add(timer); return timer; },
    clearTimeout: timer => timeouts.delete(timer),
    fetch: async (url, options) => { requests.push({ url, options }); return fetchImpl(url, options); }
  });
  const source = await readFile(new URL('../../sites/zpp-public-website/website.js', import.meta.url), 'utf8');
  const pricingSource = source.slice(source.indexOf('const PRICING_ENDPOINT'), source.indexOf('// Scroll reveal'))
    .replace('\nloadPublicRates();', '\nglobalThis.publicRatesReady = loadPublicRates();');
  vm.runInContext(pricingSource, context);
  const settle = () => new Promise(resolve => setImmediate(resolve));
  await context.publicRatesReady;
  const content = element => element.children.length ? element.children.map(content).join(' ') : element.textContent;
  return {
    elements, document, window, requests, intervals, timeouts, settle,
    refresh: () => context.loadPublicRates(),
    table: metal => elements[`[data-rate-table="${metal}"]`].children.filter(row => row.className !== 'rate-group').map(content)
  };
}
