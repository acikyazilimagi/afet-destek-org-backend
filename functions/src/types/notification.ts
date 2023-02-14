export type NotificationType = {
  geo: FirebaseFirestore.GeoPoint;
  geoHash: string;
  fcmToken: string;
  categoryIds: string[];
  locale: string;
  radiusKM?: number | null;
};
