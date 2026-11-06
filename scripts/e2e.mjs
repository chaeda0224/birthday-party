import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const browser=await chromium.launch({channel:process.env.PW_CHANNEL??'chrome',headless:true});
let page;
try{
 const context=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce'});page=await context.newPage();
 await page.goto(process.env.SITE_URL??'http://127.0.0.1:4173/');
 await page.getByRole('button',{name:'혼자 축하하기',exact:true}).click();
 await page.getByPlaceholder('축하할 이름',{exact:true}).fill('[NAME_SAMPLE]');
 await page.getByRole('button',{name:'축하 준비 완료',exact:true}).click();
 await page.getByRole('button',{name:'촛불 켜기',exact:true}).click();
 await page.getByRole('button',{name:'다 같이 불기',exact:true}).click();
 for(let i=0;i<5;i++){await page.getByRole('button',{name:'바람 보태기',exact:true}).click();await page.waitForTimeout(300);}
 await page.getByRole('button',{name:'한 번 더 축하하기',exact:true}).waitFor();
 await page.getByRole('button',{name:'파티 종료하고 정보 지우기',exact:true}).click();
 await page.getByRole('heading',{name:'생일 업무 종료',exact:true}).waitFor();
 assert.equal(await page.getByText('[NAME_SAMPLE]',{exact:true}).count(),0);
 const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth);
 assert.equal(overflow,false);
 console.log(JSON.stringify({status:'PASS',checks:['single-phone-button-flow','ended-profile-cleared','no-horizontal-overflow'],limits:'Physical mic, motion and realtime are separate tests'}));
}finally{await browser.close();}
