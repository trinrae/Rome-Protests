#!/usr/bin/env python3
"""Optional Playwright smoke test with local assets in restricted/offline test environments."""
from pathlib import Path
import re
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
html=(ROOT/'index.html').read_text('utf-8')
css=(ROOT/'styles.css').read_text('utf-8')
html=re.sub(r'<link rel="stylesheet"[^>]*>', '', html)
html=re.sub(r'<script defer[^>]*></script>', '', html)
html=html.replace('</head>', '<style>'+css+'</style></head>')

with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
    page=browser.new_page(viewport={'width':1560,'height':1020},device_scale_factor=1)
    errors=[]
    page.on('pageerror',lambda exc: errors.append(str(exc)))
    page.set_content(html,wait_until='load',timeout=30000)
    page.evaluate("Object.defineProperty(window, 'localStorage', {configurable: true, value: (function(){const v={};return {getItem:k=>v[k]||null,setItem:(k,x)=>{v[k]=String(x)},removeItem:k=>{delete v[k]}}})()})")
    page.add_script_tag(content=(ROOT/'data/snapshot.js').read_text('utf-8'))
    page.add_script_tag(content=(ROOT/'app.js').read_text('utf-8'))
    page.wait_for_timeout(500)
    print('HEALTH',page.evaluate('window.romeMonitorHealth ? window.romeMonitorHealth() : null'))
    print('KPI',[(v,page.locator('#kpi-'+v).inner_text()) for v in ['upcoming','inwindow','impact','discovery']])
    print('CARDS',page.locator('.event-item').count())
    print('JS ERRORS',errors)
    page.screenshot(path=str(ROOT/'preview-desktop.png'),full_page=True)
    assert page.locator('.event-item').count()==4
    page.locator('.event-item').first.click()
    assert 'open' in page.locator('#event-drawer').get_attribute('class')
    assert 'romamobilita.it' in page.locator('.drawer-action').get_attribute('href')
    page.locator('#close-drawer').click()
    page.locator('#add-watch-btn').click()
    page.locator('#wp-name').fill('Test Venue')
    page.locator('#wp-lat').fill('41.9031')
    page.locator('#wp-lng').fill('12.5154')
    page.locator('#watchpoint-form button[type=submit]').click()
    print('WATCHPOINT COUNT',page.locator('#watchpoint-count').inner_text())
    assert page.locator('#watchpoint-count').inner_text()=='1'
    page.locator('[data-nav="overview"]').click()
    print('EXPOSURE',page.locator('#exposure-content').inner_text()[:170])
    page.locator('#event-search').fill('nonexistent')
    assert page.locator('.event-item').count()==0
    page.locator('#clear-filters').click()
    assert page.locator('.event-item').count()==4
    page.locator('[data-nav="discovery"]').click()
    assert page.locator('#discovery-source-status').is_visible()
    print('JS ERRORS AFTER ACTIONS',errors)
    assert not errors, errors
    mobile=browser.new_page(viewport={'width':390,'height':844},device_scale_factor=1)
    mobile.on('pageerror',lambda exc: errors.append(str(exc)))
    mobile.set_content(html,wait_until='load')
    mobile.evaluate("Object.defineProperty(window, 'localStorage', {configurable: true, value: (function(){const v={};return {getItem:k=>v[k]||null,setItem:(k,x)=>{v[k]=String(x)},removeItem:k=>{delete v[k]}}})()})")
    mobile.add_script_tag(content=(ROOT/'data/snapshot.js').read_text('utf-8'))
    mobile.add_script_tag(content=(ROOT/'app.js').read_text('utf-8'))
    mobile.wait_for_timeout(350)
    mobile.screenshot(path=str(ROOT/'preview-mobile.png'),full_page=True)
    assert mobile.locator('.event-item').count()==4
    assert not errors,errors
    print('Mobile viewport works; all browser smoke checks passed')
    browser.close()
