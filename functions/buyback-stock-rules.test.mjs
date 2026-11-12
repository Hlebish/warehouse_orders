import {initializeTestEnvironment,assertSucceeds,assertFails} from '@firebase/rules-unit-testing';
import {doc,setDoc,updateDoc,writeBatch,serverTimestamp} from 'firebase/firestore';
import {readFileSync} from 'node:fs';
const env=await initializeTestEnvironment({projectId:'demo-warehouse-stock',firestore:{host:'127.0.0.1',port:8086,rules:readFileSync(new URL('../firestore.rules',import.meta.url),'utf8')}});
let checks=0;
const check=async(name,operation,allowed)=>{await(allowed?assertSucceeds(operation):assertFails(operation));checks++;console.log('PASS',name);};
const base={article:'A1',name:'Деталь',quantity:5,receivedAt:'2026-10-01',supplier:'Поставщик',comment:'История сохранена',status:'expired',createdBy:'accountant',createdByName:'Анна',sentMilestones:[3,6,10]};
const receipt={status:'stocked',stockedAt:'2026-11-12',stockedBy:'accountant',stockedByName:'Анна',updatedAt:serverTimestamp()};
const db=env.authenticatedContext('accountant').firestore();
try{
 await env.withSecurityRulesDisabled(async c=>{for(const [uid,role]of [['accountant','accountant'],['other','chief_accountant'],['warehouse','warehouse']])await setDoc(doc(c.firestore(),'users',uid),{active:true,role});await setDoc(doc(c.firestore(),'buybackItems','expired'),base);});
 await check('accept a whole expired lot',updateDoc(doc(db,'buybackItems','expired'),receipt),true);
 await check('another accountant may comment without changing receipt author',updateDoc(doc(env.authenticatedContext('other').firestore(),'buybackItems','expired'),{comment:'Уточнение'}),true);
 await check('reject receipt author spoofing',updateDoc(doc(db,'buybackItems','expired'),{stockedBy:'other'}),false);
 await check('reject malformed receipt metadata',updateDoc(doc(db,'buybackItems','expired'),{stockedByName:42}),false);
 await check('reject unknown status',updateDoc(doc(db,'buybackItems','expired'),{status:'unknown'}),false);
 await check('reject accepting stock without required receipt metadata',setDoc(doc(db,'buybackItems','bad'),{...base,status:'stocked'}),false);
 await check('warehouse role does not gain accounting access',setDoc(doc(env.authenticatedContext('warehouse').firestore(),'buybackItems','blocked'),{...base,...receipt,createdBy:'warehouse',stockedBy:'warehouse'}),false);
 await env.withSecurityRulesDisabled(async c=>{await setDoc(doc(c.firestore(),'buybackItems','partial'),{...base,returnedFromOrderId:'old-order',returnedFromReturnId:'old-return'});});
 const batch=writeBatch(db);batch.update(doc(db,'buybackItems','partial'),{quantity:3,updatedAt:serverTimestamp()});batch.set(doc(db,'buybackItems','accepted-two'),{...base,quantity:2,returnedFromOrderId:'old-order',returnedFromReturnId:'old-return',...receipt,createdAt:serverTimestamp()});await check('partial acceptance preserves receipt and return lineage atomically',batch.commit(),true);
 await check('sell accepted warehouse stock',updateDoc(doc(db,'buybackItems','accepted-two'),{status:'sold',soldAt:'2026-11-12'}),true);
 await check('undo acceptance and restore deadline control',updateDoc(doc(db,'buybackItems','expired'),{status:'active',stockedAt:null,stockedBy:null,stockedByName:null}),true);
 for(const status of ['active','returned','sold','cancelled','expired','shipped'])await check('existing status remains writable '+status,setDoc(doc(db,'buybackItems','old-'+status),{...base,status}),true);
 console.log('Buyback stock rules:',checks,'checks passed');
}finally{await env.cleanup();}
