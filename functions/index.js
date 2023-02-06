const functions = require("firebase-functions");
const { initializeApp, applicationDefault, cert } = require('firebase-admin/app');
const { getFirestore, Timestamp, FieldValue } = require('firebase-admin/firestore');

initializeApp();

const db = getFirestore();

exports.registerUser = functions.auth.user().onCreate(async (user) => {
    const usersCollection = db.collection('users');

    const userDoc = await usersCollection.doc(user.uid).get();
    if (userDoc.exists) {
        return;
    }

    const { uid, phoneNumber } = user;

    return usersCollection.doc(user.uid).set({
        uid,
        phoneNumber,
        isSuppended: false,
        deletedAt: null,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp()
    });
});