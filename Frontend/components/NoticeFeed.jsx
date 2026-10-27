"use client";

import NoticeAttachment from "./NoticeAttachment";
import { Alert, Empty, Loading } from "./ui";
import { API } from "../lib/api";
import { formatDateTime } from "../lib/format";
import { useResource } from "../lib/hooks";

// The building's notices as a readable feed, newest first (residents and guards)
export default function NoticeFeed() {
  const { data, error } = useResource(API.buildingNotices);

  if (error) return <Alert>{error}</Alert>;
  if (!data) return <Loading />;
  if (!data.length) return <div className="panel"><Empty title="No notices yet">Announcements from your secretary will appear here.</Empty></div>;

  return (
    <ol className="feed">
      {data.map((n) => (
        <li key={n.id}>
          <time dateTime={n.created_at}>{formatDateTime(n.created_at)}</time>
          <h2>{n.title}</h2>
          <p className="prose">{n.message}</p>
          {n.attachment && <div><NoticeAttachment notice={n} /></div>}
        </li>
      ))}
    </ol>
  );
}
