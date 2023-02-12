export type NotificationType = {
  geo: FirebaseFirestore.GeoPoint;
  geoHash: string;
  token: string;
  categoryIds: string[];
  locale: string;
};
