import {initializeApp} from 'firebase/app';
import {getFirestore,doc,onSnapshot} from 'firebase/firestore';
import {createRelay} from './relay.mjs';
// One public read-only subscription, shared by every participating phone.
// Admin writes remain protected by the existing Firebase authentication and rules.
const app=initializeApp({projectId:'meeting---coppie',apiKey:'AIzaSyAnPaUs4KvPsaT0g2M8MH_AdUe9H9zRW5o',appId:'1:1027854978190:web:a368caebc29bb1013e0ddf'});
const relay=createRelay({origin:'https://dan73-73.github.io'});
onSnapshot(doc(getFirestore(app),'state','main'),snap=>{
  if(snap.exists())relay.push(snap.data());
},err=>console.error('Firebase subscription:',err.code));
relay.server.listen(Number(process.env.PORT||8080),'0.0.0.0',()=>console.log('Meeting relay listening'));
