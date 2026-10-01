// Script para atualizar as regras do Firestore
// Execute: node deploy-rules.js

const { readFileSync } = require('fs');
const { initializeApp } = require('firebase/app');
const { getFirestore, doc, setDoc, getDoc } = require('firebase/firestore');

// Substitua com suas credenciais do Firebase
const firebaseConfig = {
  apiKey: process.env.VITE_FIREBASE_API_KEY || "SUA_API_KEY",
  authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN || "SEU_AUTH_DOMAIN",
  projectId: process.env.VITE_FIREBASE_PROJECT_ID || "SEU_PROJECT_ID",
  storageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET || "SEU_STORAGE_BUCKET",
  messagingSenderId: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "SEU_MESSAGING_SENDER_ID",
  appId: process.env.VITE_FIREBASE_APP_ID || "SEU_APP_ID",
};

console.log('Este script requer o Firebase Admin SDK para atualizar regras de segurança.');
console.log('Para atualizar as regras manualmente:');
console.log('1. Vá ao Firebase Console: https://console.firebase.google.com');
console.log('2. Selecione seu projeto');
console.log('3. Navegue para Firestore Database > Regras');
console.log('4. Copie o conteúdo do arquivo firestore.rules');
console.log('5. Cole no editor e clique em "Publicar"');
console.log('\nOu instale o Firebase CLI e execute:');
console.log('npm install -g firebase-tools');
console.log('firebase login');
console.log('firebase deploy --only firestore:rules');
