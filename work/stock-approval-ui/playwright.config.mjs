import {defineConfig} from '@playwright/test';
export default defineConfig({testDir:'../../tests/browser',testMatch:['order-approval.spec.js','order-approval-tabs.spec.js'],workers:1,timeout:45000,use:{locale:'zh-CN',viewport:{width:1440,height:1000},serviceWorkers:'block'},outputDir:'../../test-results/stock-approval'});
