import Relay from "../models/relay.ts";

export interface RelayData {
  _id?: string;
  host: string;
  inboxUrl: string;
}

export async function findRelaysByHosts(hosts: string[]): Promise<RelayData[]> {
  const docs = await Relay.find({ host: { $in: hosts } }).lean<RelayData[]>();
  return docs.map((d) => ({
    _id: String(d._id),
    host: d.host,
    inboxUrl: d.inboxUrl,
  }));
}

export async function findRelayByHost(host: string): Promise<RelayData | null> {
  const doc = await Relay.findOne({ host }).lean<RelayData | null>();
  return doc
    ? { _id: String(doc._id), host: doc.host, inboxUrl: doc.inboxUrl }
    : null;
}

export async function createRelay(data: RelayData): Promise<RelayData> {
  const doc = new Relay({ host: data.host, inboxUrl: data.inboxUrl });
  await doc.save();
  return { _id: String(doc._id), host: doc.host, inboxUrl: doc.inboxUrl };
}

export async function deleteRelayById(id: string): Promise<RelayData | null> {
  const doc = await Relay.findByIdAndDelete(id).lean<RelayData | null>();
  return doc
    ? { _id: String(doc._id), host: doc.host, inboxUrl: doc.inboxUrl }
    : null;
}
