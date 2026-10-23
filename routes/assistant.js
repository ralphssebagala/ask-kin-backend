const express = require('express');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const router = express.Router();

// Import canonical FAQ from data/faq.js (same as frontend) - but keep inline for backend self-contained
const faqs = [
  { q: "How do I start a fundraiser?", a: "Starting a fundraiser on Ask Kin is free and takes just 5 minutes:\n\n1. Click 'Start a Fundraiser'\n2. Create account with Phone + NIN/Passport\n3. Choose Category\n4. Write specific title\n5. Add real cover photo + optional YouTube/TikTok link\n6. Tell your story: Who, what happened, how funds will be used with breakdown - Explain clearly for donors. A clear detailed story helps donors understand and builds trust.\n7. Set Goal and Duration OR select 'Ongoing Campaign'\n8. Choose payout currency and enter Mobile Money/Bank details (name MUST match ID). Bank fields: Bank name, Account name, Account number, Branch.\n9. Web: Upload ID + LC1 letter as supporting doc only (we verify, not LC chairman). Mobile: LC not required.\n10. Submit - usually approved in under 2 hours.", keys: ["start a fundraiser","start","create fundraiser","how do i start"] },
  { q: "What are the fees?", a: "One simple fee: 10% per donation covers everything - Mobile Money/Bank charges, licensed aggregator fees, platform maintenance.\n\nExample: Donor gives UGX 100,000 -> You receive UGX 90,000 in fundraiser's local currency (UGX/KES/TZS/RWF/ZMW).\n\nNo upfront cost, no monthly fees, no listing fees, no withdrawal fees. International card may have extra bank FX fees.", keys: ["fees","fee","charge","percentage","10%"] },
  { q: "When will I receive my money?", a: "Automatic weekly payouts every Monday at 11:00 AM EAT.\n\nIf balance >= UGX 50,000 or equivalent, auto payout - no request needed.\n• Mobile Money: within 2 hours\n• Bank: 24-48h (Bank name, Account name, Number, Branch must match ID)\n• SMS + email confirmation\n• Payout strictly in fundraiser's local currency\n• If less than 50k, rolls to next Monday.", keys: ["when will i receive","receive my money","payout when","how long until","when payout","monday"] },
  { q: "Can I donate anonymously?", a: "Yes! Check 'Donate anonymously' on donation page. Name/nickname hidden from public feed, organizer still sees in dashboard for accountability. Email optional for receipt/payout notification. Amount never public unless you choose.", keys: ["anonymous","anonymously"] },
  { q: "Why was my campaign rejected?", a: "Common reasons:\n• Unclear story/goal - Explain clearly for donors, detailed story builds trust (not LC1)\n• Prohibited category\n• Duplicate campaign\n• Mismatched ID and payout name (NIN must match MoMo/Bank name including Bank fields)\n• Photo violates policy\n• Missing ID/Bank or LC1 supporting doc (web only)\n\nYou get email with reason and can resubmit after fixing. We authorize/contact/reject, not LC chairman.", keys: ["rejected","rejection","why rejected"] },
  { q: "What is Ask Kin?", a: "Ask Kin is East Africa's native crowdfunding platform. Motto: 'Rekindle the Gift of Giving.' Tech platform connecting those who need help with kin/community. Not charity, not bank. Payouts in Uganda, Kenya, Tanzania, Rwanda, Zambia in fundraiser's local currency. Monday 11AM payouts, 50k threshold, 10% fee. Funds held by licensed aggregator, not Ask Kin.", keys: ["what is ask kin","about ask kin"] },
  { q: "Which countries?", a: "Payouts V1: Uganda, Kenya, Tanzania, Rwanda, Zambia. Location chosen at creation cannot change. Diaspora can donate FROM anywhere via card, payout TO those 5 in fundraiser's local currency. LC1 supporting doc only on web.", keys: ["countries","which countries","diaspora"] },
  { q: "Minimum donation?", a: "Minimum UGX 1,000 (~$0.30) or equivalent. No maximum, but >UGX 10M may trigger verification.", keys: ["minimum","min donation","least"] },
  { q: "Do I need account to donate?", a: "No account needed to donate. Guest via licensed aggregator secure page (MTN, Airtel, M-Pesa, Orange, Tigo, Wave, Card, Bank - aggregator controls options). Account only to start/manage fundraiser. Bank option via same aggregator.", keys: ["need account","account to donate","guest"] },
  { q: "Refund?", a: "Donations final via licensed aggregator escrow in fundraiser's local currency. Refunds only for proven fraud or double-charge within 48h with transaction ID to support@ask-kin.com.", keys: ["refund","return"] },
  { q: "Share?", a: "On campaign card click 'Share with your community' - WhatsApp, Facebook, X, TikTok. Can't donate? Sharing helps as much - one share can bring 3 donors. Recent donor ticker shows live activity: Sarah + 3 others donated.", keys: ["share","sharing"] },
  { q: "What is LC1 letter for?", a: "Web only: LC1 letter is supporting document only, uploaded during creation. We verify campaigns - LC chairman does NOT need to verify at cafe or be present. We authorize, contact for more info, or reject in extreme cases. Mobile: LC1 not required.", keys: ["lc1","lc letter","chairman"] },
  { q: "Bank payout fields?", a: "Bank payout option: Bank name, Account name, Account number, Branch. Name must match ID. Aggregator follows fundraiser's lead - if fundraiser chose Bank, payout goes to bank in fundraiser's local currency. Monday 11AM if >=50k equiv. Internal selector, not donor choice.", keys: ["bank","bank account","bank payout","account number"] },
];

const SYSTEM_PROMPT = `You are Ask Kin Assistant. Warm, concise, helpful. Answer ONLY from KB. Keep <180 words. Always mention fundraiser's local currency, not just UGX. Mention bank fields when relevant: Bank name, Account name, Number, Branch. LC1 is supporting doc only on web, we verify. KB:\n${faqs.map(f=>`Q: ${f.q}\nA: ${f.a}`).join('\n\n')}\nIf not in KB: "I'm still learning that. Please check FAQ at /faq or contact human support via Live Chat or WhatsApp wa.me/256780792170 (admin number private)." Never ask for PINs.`;

let genAI=null;
const cache=new Map();
let failCount=0;
let skipUntil=0;

function smartFallback(message){
  const low=message.toLowerCase();
  // keyword match
  for(const f of faqs){ if(f.keys.some(k=>low.includes(k))) return f.a; }
  // intent scoring - avoid returning faqs[0] for everything
  let best=null, sc=0;
  for(const f of faqs){
    let s=0;
    f.q.toLowerCase().split(/\W+/).forEach(w=>{ if(w.length>3 && low.includes(w)) s++; });
    f.keys.forEach(k=>{ if(low.includes(k)) s+=2; });
    if(s>sc){ sc=s; best=f; }
  }
  if(best && sc>=2) return best.a;
  // No good match - return helpful general answer, NOT faqs[0]
  if(low.includes("bank") || low.includes("account")) return faqs.find(f=>f.q.includes("Bank")).a;
  if(low.includes("lc") || low.includes("chairman") || low.includes("letter")) return faqs.find(f=>f.q.includes("LC1")).a;
  if(low.includes("fee") || low.includes("percent")) return faqs.find(f=>f.q.includes("fees")).a;
  if(low.includes("payout") || low.includes("receive") || low.includes("monday")) return faqs.find(f=>f.q.includes("receive")).a;
  if(low.includes("share") || low.includes("donor")) return faqs.find(f=>f.q.includes("Share")).a;
  return `I couldn't find exact answer for "${message}". Quick help:\n• Fees 10% → recipient gets 90% in fundraiser's local currency\n• Payouts Mon 11AM EAT if >=50k equiv (MoMo 2hrs, Bank 24-48h with Bank name/Account name/Number/Branch)\n• Web: LC1 is supporting doc only, we verify not chairman\n• Donate anonymously + share helps as much\n• Bank option via same licensed aggregator\n• Check FAQ page or WhatsApp wa.me/256780792170 (human support, admin number private)`;
}

function withTimeout(promise, ms){
  return Promise.race([
    promise,
    new Promise((_,reject)=>setTimeout(()=>reject(new Error('TIMEOUT')), ms))
  ]);
}

router.post('/chat', async (req,res)=>{
  const {message}=req.body;
  if(!message?.trim()) return res.status(400).json({error:"Message required"});
  const key=message.toLowerCase().trim();
  if(cache.has(key)) return res.json({answer:cache.get(key), cached:true, fallback:false});

  const now=Date.now();
  if(now < skipUntil){
    const fb=smartFallback(message);
    cache.set(key, fb);
    return res.json({answer:fb, fallback:true, reason:'cooldown'});
  }

  if(process.env.GEMINI_API_KEY){
    if(!genAI) genAI=new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    try{
      const model=genAI.getGenerativeModel({
        model:"gemini-flash-latest",
        systemInstruction:SYSTEM_PROMPT,
        generationConfig:{temperature:0.2, maxOutputTokens:600}
      });
      const result=await withTimeout(model.generateContent(message.trim()), 6000);
      const answer=result.response.text();
      if(answer && answer.length>20){
        failCount=0;
        cache.set(key, answer);
        return res.json({answer, fallback:false});
      }
    }catch(e){
      console.error('Gemini fail', e.message);
      failCount++;
      if(failCount>=3) skipUntil=Date.now()+ 2*60*1000;
    }
  }

  const fallback=smartFallback(message);
  cache.set(key, fallback);
  return res.json({answer:fallback, fallback:true});
});

module.exports=router;

