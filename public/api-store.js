// A small client for the Task Organizer API that offers the same
// collection-style interface app.js already uses (add / doc().update /
// doc().delete / doc().set / where().get / onSnapshot), so the UI code
// barely changes. Writes are applied to the local copy straight away for a
// snappy UI, then the collection is re-fetched to stay in sync with the
// server. The session lives in an httpOnly cookie; nothing here touches it.
(function(){
  "use strict";

  function emitError(status){
    window.dispatchEvent(new CustomEvent("taskapi:error", { detail: { status: status } }));
  }

  async function request(method, path, body, allow404){
    var headers = { "X-Requested-With": "fetch" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    var res;
    try {
      res = await fetch(path, {
        method: method,
        credentials: "same-origin",
        headers: headers,
        body: body !== undefined ? JSON.stringify(body) : undefined
      });
    } catch (e){
      emitError(0);
      throw e;
    }
    if (res.status === 401){
      window.location.href = "/login";
      throw new Error("Signed out");
    }
    if (res.status === 404 && allow404) return null;
    if (!res.ok){
      emitError(res.status);
      throw new Error("Request failed (" + res.status + ")");
    }
    return res.status === 204 ? null : res.json();
  }

  function snapshotOf(items){
    return {
      docs: items.map(function(item){
        return { id: item.id, data: function(){ return Object.assign({}, item); } };
      })
    };
  }

  function Collection(name){
    this.url = "/api/" + name;
    this.items = [];
    this.listeners = [];
    this.timer = null;
    this.inFlight = false;
    this.again = false;
  }
  Collection.prototype.notify = function(){
    var snap = snapshotOf(this.items);
    this.listeners.forEach(function(l){ l.onNext(snap); });
  };
  Collection.prototype.fetchNow = async function(){
    if (this.inFlight){ this.again = true; return; }
    this.inFlight = true;
    try {
      this.items = await request("GET", this.url);
      this.notify();
    } catch (e){
      this.listeners.forEach(function(l){ if (l.onError) l.onError(e); });
    } finally {
      this.inFlight = false;
      if (this.again){ this.again = false; this.fetchNow(); }
    }
  };
  // Coalesces bursts of writes (e.g. a drag reorder touching many tasks)
  // into one re-fetch.
  Collection.prototype.scheduleRefresh = function(){
    var self = this;
    clearTimeout(this.timer);
    this.timer = setTimeout(function(){ self.fetchNow(); }, 250);
  };
  Collection.prototype.onSnapshot = function(onNext, onError){
    this.listeners.push({ onNext: onNext, onError: onError });
    this.fetchNow();
  };
  Collection.prototype.add = async function(body){
    try {
      var created = await request("POST", this.url, body);
      this.items.push(created);
      this.notify();
      return { id: created.id };
    } finally {
      this.scheduleRefresh();
    }
  };
  Collection.prototype.where = function(field, op, value){
    var self = this;
    return {
      get: async function(){
        var items = await request("GET", self.url);
        return snapshotOf(items.filter(function(x){ return op === "==" && x[field] === value; }));
      }
    };
  };
  Collection.prototype.doc = function(id){
    var self = this;
    var url = this.url + "/" + encodeURIComponent(id);
    function local(apply){
      var idx = self.items.findIndex(function(x){ return x.id === id; });
      apply(idx);
      self.notify();
    }
    return {
      update: async function(patch){
        local(function(i){ if (i >= 0) self.items[i] = Object.assign({}, self.items[i], patch); });
        try { await request("PATCH", url, patch); } finally { self.scheduleRefresh(); }
      },
      set: async function(body){
        local(function(i){
          var rec = Object.assign({ id: id }, body);
          if (i >= 0) self.items[i] = rec; else self.items.push(rec);
        });
        try { await request("PUT", url, body); } finally { self.scheduleRefresh(); }
      },
      delete: async function(){
        local(function(i){ if (i >= 0) self.items.splice(i, 1); });
        // Already gone (e.g. removed along with its board) counts as success.
        try { await request("DELETE", url, undefined, true); } finally { self.scheduleRefresh(); }
      }
    };
  };

  var collections = {};
  window.TaskApi = {
    me: function(){ return request("GET", "/api/me"); },
    collection: function(name){
      return collections[name] || (collections[name] = new Collection(name));
    },
    logout: function(){ return request("POST", "/auth/logout"); }
  };
})();
