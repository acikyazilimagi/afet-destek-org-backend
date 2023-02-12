export type DemandType = {
  addressText: string;
  categoryIds: string[];
  createdTime: FirebaseFirestore.Timestamp;
  fullAddressText: string;
  geo: FirebaseFirestore.GeoPoint;
  geoHash: string;
  isActive: boolean;
  notes: string;
  phoneNumber: string;
  updatedTime: FirebaseFirestore.Timestamp;
  userId: string;
  whatsappNumber: string;
};
