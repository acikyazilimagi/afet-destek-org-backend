const functions = require("firebase-functions");
const admin = require("firebase-admin");
const axios = require("axios");
const cors = require("cors")({ origin: true });

const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { FirebaseFunctionsRateLimiter } = require("firebase-functions-rate-limiter");

initializeApp();

const db = getFirestore();

const configuration = {
    name: "demands", // a collection with this name will be created
    periodSeconds: 60, // the length of test period in seconds
    maxCalls: 20,// number of maximum allowed calls in the period
    debug: true // boolean (default false)
};

const limiter = FirebaseFunctionsRateLimiter.withFirestoreBackend(configuration, db)

exports.getDemands = functions.https.onRequest((req, res) => {
    cors(req, res, async () => {
        if (req.method !== 'POST') {
            res.status(405).send('Method Not Allowed');
            return;
        }
        const quotaExceeded = await limiter.isQuotaAlreadyExceeded();
        if (quotaExceeded) {
            res.status(429).send('Too Many Requests');
            return;
        }
        const demandsCollection = db.collection('demands');
        const demands = await demandsCollection.get();
        const demandsData = demands.docs.map(doc => doc.data());
        res.send({
            demands: demandsData
        });
    });
});

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
        isSuspended: false,
        deletedAt: null,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp()
    });
});

exports.onUserUpdate = functions.firestore
    .document('users/{userId}')
    .onUpdate(async (change, context) => {
        const { userId } = context.params;
        const { isSuspended } = change.after.data();

        const userRecord = await admin.auth().getUser(userId);
        const { disabled } = userRecord;

        if (isSuspended !== disabled) {
            await admin.auth().updateUser(userId, { disabled: isSuspended });
        }
    });

exports.onDemandCreate = functions.firestore
    .document('demands/{docId}')
    .onCreate(async (snap) => {
        const url = 'https://httpbin.org/post'
        const demand = snap.data();
        const response = await axios.post(url, demand);
        const data = await response.data;
        console.log(data);
    });