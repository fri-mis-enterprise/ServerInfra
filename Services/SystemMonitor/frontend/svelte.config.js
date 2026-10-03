import adapter from '@sveltejs/adapter-static';
export default {kit: {adapter: adapter({fallback: 'index.html'}), paths: {base: process.env.BASE_PATH ?? '/systemmonitor'}, csp: {mode: 'hash', directives: {'default-src':['self'], 'script-src':['self'], 'style-src':['self', 'unsafe-inline'], 'object-src':['none'], 'base-uri':['none'], 'frame-ancestors':['none']}}}};
