import * as admin from "firebase-admin";
import { Message } from "firebase-admin/lib/messaging/messaging-api";
import { Geopoint, geohashQueryBounds, distanceBetween } from "geofire-common";
import { NotificationType } from "./types/notification";

type sendNotificationsParams = {
  geo: {
    latitude: number;
    longitude: number;
  };
  demandId: string;
  categoryIds?: string[];
  db: FirebaseFirestore.Firestore;
};

type matchingNotifications = {
  [docId: string]: {
    locale: string;
    token: string;
  };
};

type generateFCMMessageParams = {
  fcmToken: string;
  demandId: string;
};

type notifyVolunteersWhereRadiusIsNullParams = {
  categoryIds: string[];
  demandId: string;
  db: FirebaseFirestore.Firestore;
};

const generateFCMMessage = (params: generateFCMMessageParams): Message => {
  const { fcmToken, demandId } = params;
  return {
    token: fcmToken,
    notification: {
      title: "Yeni bir yardim talebi var!",
      body: "Yakınınızda yeni bir yardım talebi oluşturuldu.",
    },
    webpush: {
      fcmOptions: {
        link: `https://afetdestek.org/demand/${demandId}`,
      },
    },
  };
};

// TODO: to notify users we may iterate over all notification
// because we can't properly query with different conditions

export const notifyVolunteersWhereRadiusIsNull = async (
  params: notifyVolunteersWhereRadiusIsNullParams
) => {
  const { demandId, db } = params;
  const query: admin.firestore.CollectionReference | admin.firestore.Query =
    db.collection("notifications");

  const querySnapshot = await query.where("radiusKm", "==", -1).get();
  console.log(querySnapshot.size);
  querySnapshot.forEach(async (doc) => {
    const { fcmToken, categoryIds } = doc.data() as NotificationType;
    if (categoryIds && categoryIds.length > 0) {
      if (
        categoryIds.some((categoryId) =>
          params.categoryIds.includes(categoryId)
        )
      ) {
        try {
          const fcmMessage = generateFCMMessage({
            fcmToken,
            demandId,
          });
          await admin.messaging().send(fcmMessage);
          console.log("called for doc.id");
        } catch (e) {
          console.log(e);
          await db.collection("notifications").doc(doc.id).delete();
        }
      }
    } else {
      try {
        const fcmMessage = generateFCMMessage({
          fcmToken,
          demandId,
        });
        await admin.messaging().send(fcmMessage);
        console.log("called for doc.id");
      } catch (e) {
        console.log(e);
        await db.collection("notifications").doc(doc.id).delete();
      }
    }
  });
};

export const notifyVolunteers = async (params: sendNotificationsParams) => {
  const { geo, categoryIds, demandId, db } = params;
  const geoPoint: Geopoint = [geo.latitude, geo.longitude];
  const radiusInM = 100 * 1000;
  let query: admin.firestore.CollectionReference | admin.firestore.Query = admin
    .firestore()
    .collection("notifications");

  const bounds = geohashQueryBounds(geoPoint, radiusInM);
  const promises: Promise<FirebaseFirestore.QuerySnapshot>[] = [];

  if (categoryIds && categoryIds.length > 0) {
    query = query.where("categoryIds", "array-contains-any", categoryIds);
  }

  for (const b of bounds) {
    query.orderBy("geoHash").startAt(b[0]).endAt(b[1]);

    promises.push(query.get());
  }

  const matchingNotifications: matchingNotifications = {};

  const snapshots = await Promise.all(promises);
  for (const snap of snapshots) {
    for (const doc of snap.docs) {
      const notification: NotificationType = doc.data() as NotificationType;
      const notificationGeopoint: Geopoint = [
        notification.geo.latitude,
        notification.geo.longitude,
      ];

      const distanceInKm = distanceBetween(notificationGeopoint, geoPoint);
      const distanceInM = distanceInKm * 1000;
      if (distanceInM <= radiusInM) {
        matchingNotifications[doc.id] = {
          locale: notification.locale,
          token: notification.fcmToken,
        };
      }
    }
  }
  Object.keys(matchingNotifications).forEach(async (docID) => {
    try {
      const fcmMessage = generateFCMMessage({
        fcmToken: matchingNotifications[docID].token,
        demandId,
      });
      await admin.messaging().send(fcmMessage);
    } catch (e) {
      await db.collection("notifications").doc(docID).delete();
    }
  });
};
