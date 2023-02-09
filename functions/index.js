const functions = require("firebase-functions");
const admin = require("firebase-admin");
const cors = require("cors")({ origin: true });
const geofire = require("geofire-common");

const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { FirebaseFunctionsRateLimiter } = require("firebase-functions-rate-limiter");

const dataBackup = require('./dataBackup');
const karaListe = require('./data/karaListe');


initializeApp();

const db = getFirestore();

const configuration = {
    name: "demands", // a collection with this name will be created
    periodSeconds: 60, // the length of test period in seconds
    maxCalls: 20,// number of maximum allowed calls in the period
    debug: true // boolean (default false)
};

const limiter = FirebaseFunctionsRateLimiter.withFirestoreBackend(configuration, db)

exports.scheduledFirestoreExport = dataBackup.scheduledFirestoreExport;

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

        let query = db.collection('demands')
        const pageSize = 20

        const { geo, radius, categoryIds, page } = req.body;

        if (!page) {
            res.status(400).send('Bad Request, page is required');
        }

        if (!geo) {
            res.status(400).send('Bad Request, geo is required');

        }

        if (categoryIds && categoryIds.length > 0) {
            query = query.where('categoryIds', 'array-contains-any', categoryIds)
        }

        function handleRequestWithRadius() {
            const center = [Number.parseFloat(geo.latitude), Number.parseFloat(geo.longitude)]
            const radiusInM = Number.parseFloat(radius) * 1000;
            const bounds = geofire.geohashQueryBounds(center, radiusInM);

            // https://firebase.google.com/docs/firestore/solutions/geoqueries
            const promises = [];
            for (const b of bounds) {
                const q = query
                    .orderBy('geoHash')
                    .startAt(b[0])
                    .endAt(b[1]);

                promises.push(q.get());
            }

            Promise.all(promises).then((snapshots) => {
                return snapshots.map(snapshot => snapshot.docs)
                    .flat()
                    .filter(doc => {
                        const lat = doc.data().geo.latitude;
                        const lng = doc.data().geo.longitude;

                        // We have to filter out a few false positives due to GeoHash
                        // accuracy, but most will match
                        const distanceInKm = geofire.distanceBetween([lat, lng], [geo.latitude, geo.longitude]);
                        const distanceInM = distanceInKm * 1000;
                        return distanceInM <= radiusInM;
                    })
            }).then((matchingDocs) => {
                const slicedMatchingDocs = matchingDocs.slice((page - 1) * pageSize, page * pageSize);
                res.send({
                    demands: slicedMatchingDocs.map(doc => compileDemandDocument(doc))
                })
            });
        }

        function handleRequestWithoutRadius() {
            query = query.orderBy('updatedTime', 'desc')
                .limit(pageSize)
                .offset((page - 1) * pageSize)

            query.get().then((snapshot) => {
                res.send({
                    demands: snapshot.docs.map(doc => compileDemandDocument(doc))
                })
            })
        }

        function compileDemandDocument(doc) {
            const data = doc.data();
            const lat = data.geo.latitude;
            const lng = data.geo.longitude;
            const distanceInKm = geofire.distanceBetween([lat, lng], [geo.latitude, geo.longitude]);
            const distanceInM = distanceInKm * 1000;

            data.geo = {
                latitude: lat,
                longitude: lng
            };
            data.modifiedTimeUtc = data.updatedTime.toDate();
            data.distanceMeter = parseInt(distanceInM);
            data.id = doc.id;

            delete data.updatedTime;

            return {
                ...data
            };
        }

        if (radius) {
            handleRequestWithRadius();
            return;
        }

        handleRequestWithoutRadius();
    });
});

// runs on auth user creation
exports.registerUser = functions.auth.user().onCreate(async (user) => {
    const usersCollection = db.collection('users');

    const userDoc = await usersCollection.doc(user.uid).get();
    if (userDoc.exists) {
        return;
    }

    const { uid, phoneNumber } = user;


    return usersCollection.doc(user.uid).set({
        id: uid,
        phoneNumber,
        isSuspended: false,
        deletedAt: null,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp()
    });
});

// runs on `users` collection update
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

// runs on `demands` collection create
exports.onDemandCreate = functions.firestore
    .document('demands/{docId}')
    .onCreate(async (snap) => {
        const demand = snap.data();
        const { geo, notes } = demand;
        const hash = geofire.geohashForLocation([geo.latitude, geo.longitude]);
        return snap.ref.set({
            geoHash: hash
        }, { merge: true });
    });

// runs on `demands` collection create or update
exports.onDemandModify = functions.firestore
    .document('demands/{docId}')
    .onWrite(async (change, context) => {
        const demand = change.after.data();
        if (demand.notes) {
            let splittedNote = demand.notes.split(' ');
            for (const word of splittedNote) {
                if (karaListe.includes(word)) {
                    return change.after.ref.set({
                        notes: FieldValue.delete()
                    }, { merge: true });
                }
            }
        }
    }
    );
