export type MasterQuickCreate = {
  onCreated: (record: { id: string; name: string; truck_type_id?: string }) => Promise<void>;
  onClose: () => void;
  truckTypeId?: string;
  supplierId?: string;
};
