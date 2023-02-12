import * as admin from "firebase-admin";
import { getFirestore } from "firebase-admin/firestore";
import { Geopoint, geohashQueryBounds, distanceBetween } from "geofire-common";
import { NotificationType } from "./types/notification";

type sendNotificationsParams = {
  geo: {
    latitude: number;
    longitude: number;
  };
  demandId: string;
  categoryIds?: string[];
};

type matchingNotifications = {
  [docId: string]: {
    locale: string;
    token: string;
  };
};

export const notifyVolunteers = async (params: sendNotificationsParams) => {
  console.log("notifyVolunteers called");
  const { geo, categoryIds, demandId } = params;
  const geoPoint: Geopoint = [geo.latitude, geo.longitude];
  const radiusInM = 50 * 1000;
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
          token: notification.token,
        };
      }
    }
  }
  const db = getFirestore();
  Object.keys(matchingNotifications).forEach(async (docID) => {
    try {
      await admin.messaging().send({
        data: {
          demandId,
        },
        token: matchingNotifications[docID].token,
      });
    } catch (e) {
      db.collection("notifications").doc(docID).delete();
    }
  });
};
