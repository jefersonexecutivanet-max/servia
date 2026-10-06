const admin = require('firebase-admin');
const serviceAccount = require('./firebase-service-account.json');

// Inicializar Firebase Admin
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();
const auth = admin.auth();

// Gerar senha aleatória se não fornecida
function generatePassword(length = 12) {
  const charset = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*';
  let password = '';
  for (let i = 0; i < length; i++) {
    password += charset.charAt(Math.floor(Math.random() * charset.length));
  }
  return password;
}

async function createTestRestaurant() {
  const restaurantName = process.env.RESTAURANT_NAME || 'laihdoceria';
  const email = process.env.RESTAURANT_EMAIL || 'laihdoceria@servia.test';
  const password = process.env.RESTAURANT_PASSWORD || generatePassword();
  const ownerName = process.env.OWNER_NAME || 'Administrador Laihdoceria';
  const cnpj = process.env.RESTAURANT_CNPJ || '00.000.000/0001-00';

  try {
    console.log('Criando usuário no Firebase Authentication...');
    const userRecord = await auth.createUser({
      email: email,
      password: password,
      displayName: ownerName,
      emailVerified: true,
    });

    console.log('Usuário criado com UID:', userRecord.uid);

    console.log('Criando documento do restaurante no Firestore...');
    const restaurantRef = await db.collection('restaurants').doc(userRecord.uid);
    await restaurantRef.set({
      name: restaurantName,
      cnpj: cnpj,
      ownerName: ownerName,
      ownerEmail: email,
      status: 'active',
      paymentStatus: 'paid',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      activatedAt: admin.firestore.FieldValue.serverTimestamp(),
      paidAt: admin.firestore.FieldValue.serverTimestamp(),
      monthlyPaidUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    });

    console.log('Restaurante criado e ativado com sucesso!');
    console.log('\n=== CREDENCIAIS DE TESTE ===');
    console.log('Nome do restaurante:', restaurantName);
    console.log('E-mail:', email);
    console.log('Senha:', password);
    console.log('UID:', userRecord.uid);
    console.log('=============================\n');

    // Criar algumas mesas de teste
    console.log('Criando mesas de teste...');
    const tables = [
      { number: 1, status: 'livre', guests: 0, total: 0, capacity: 4, x: 10, y: 23 },
      { number: 2, status: 'livre', guests: 0, total: 0, capacity: 4, x: 38, y: 20 },
      { number: 3, status: 'livre', guests: 0, total: 0, capacity: 6, x: 68, y: 22 },
      { number: 4, status: 'livre', guests: 0, total: 0, capacity: 2, x: 13, y: 57 },
      { number: 5, status: 'livre', guests: 0, total: 0, capacity: 4, x: 42, y: 52 },
      { number: 6, status: 'livre', guests: 0, total: 0, capacity: 6, x: 72, y: 55 },
    ];

    for (const table of tables) {
      await db.collection('tables').doc(`${userRecord.uid}_${table.number}`).set({
        ...table,
        restaurantId: userRecord.uid,
      });
    }

    console.log('6 mesas de teste criadas com sucesso!');

  } catch (error) {
    console.error('Erro ao criar restaurante de teste:', error);
    process.exit(1);
  }
}

createTestRestaurant().then(() => {
  console.log('\nProcesso concluído com sucesso!');
  process.exit(0);
}).catch((error) => {
  console.error('Erro:', error);
  process.exit(1);
});
