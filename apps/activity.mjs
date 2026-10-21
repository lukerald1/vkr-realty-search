import {DatabaseSync} from 'node:sqlite';
import {randomUUID} from 'node:crypto';
export function openActivity(filename) {
  const db=new DatabaseSync(filename);
  db.exec(`PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS searches(id TEXT PRIMARY KEY,session_id TEXT,created_at TEXT,query TEXT,profile TEXT,total INTEGER);
    CREATE TABLE IF NOT EXISTS served_results(search_id TEXT,listing_id TEXT,position INTEGER,PRIMARY KEY(search_id,listing_id));
    CREATE TABLE IF NOT EXISTS events(id TEXT PRIMARY KEY,session_id TEXT,created_at TEXT,search_id TEXT,listing_id TEXT,type TEXT);
    CREATE INDEX IF NOT EXISTS history_session ON searches(session_id,created_at);`);
  return {
    search(session,query,profile,total,results,offset){
      const id=randomUUID();
      db.prepare('INSERT INTO searches VALUES (?,?,?,?,?,?)').run(id,session,new Date().toISOString(),query,JSON.stringify(profile),total);
      const insert=db.prepare('INSERT INTO served_results VALUES (?,?,?)');
      db.exec('BEGIN');try{results.forEach((item,i)=>insert.run(id,item.id,offset+i+1));db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}
      return id;
    },
    event(session,{searchId,listingId,type}){
      if(!['detail_open','favorite_add','favorite_remove','source_open'].includes(type)||typeof listingId!=='string'||typeof searchId!=='string')return false;
      const record=db.prepare('SELECT 1 FROM searches s JOIN served_results r ON r.search_id=s.id WHERE s.id=? AND s.session_id=? AND r.listing_id=?').get(searchId,session,listingId);
      if(!record)return false;
      db.prepare('INSERT INTO events VALUES (?,?,?,?,?,?)').run(randomUUID(),session,new Date().toISOString(),searchId,listingId,type);return true;
    },
    history(session){return db.prepare('SELECT id,created_at,query,total FROM searches WHERE session_id=? ORDER BY created_at DESC LIMIT 20').all(session);},
    close:()=>db.close()
  };
}
