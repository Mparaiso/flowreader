/*jslint white:true,es5:true,browser:true,devel:true,nomen:true*/
/*global async,google,Dropbox,_*/
/**
 * Copyright © 2014 mparaiso <mparaiso@online.fr>. All Rights Reserved.
 * javascript/dropboxDatabase.js
 * Domain layer,100% independant from AngularJS,should work in a webworker
 */
"use strict";
var fluxreader=fluxreader||{};
/**
 * A database table with CRUD methods,implementing the
 * datamapper design patter
 * a record is a javascript object that has an id.
 * This implementation relies on dropbox datastore table model
 * @constructor
 * @param {string} tableName
 * @param {object} database
 * @param {Function} timeout
 */
fluxreader.Table=function(tableName, database, timeout) {
    this._tableName = tableName;
    this._database = database;
    this._timeout = timeout;
};
fluxreader.Table.prototype = {
    hashToRecordFields: function (hash) {
        var record = Object.keys(hash).reduce(function (result, key) {
            result[key] = hash[key];
            return result;
        }, {});
        delete record.id;
        return record;
    },
    /**
    * @param {object} record
    */
    recordToHash: function (record) {
        if(!record){
            return;
        }
        var fields={};
        if (record.getFields instanceof Function) {
            fields = record.getFields();
            fields.id = record.getId();
            Object.keys(fields).forEach(function (key) {
                if (fields[key] && (fields[key].toArray instanceof Function)) {
                    var val = fields[key].toArray();
                    fields[key] = val;
                }
            });
        } else {
            fields = record;
        }
        return fields;
    },
    setTable: function (value) {
        this._table = value;
        return this;
    },
    /** open dropbox database,get datastore,get table by name */
    getTable: function (callback) {
        var self = this;
        if (!this._table) {
            this._database.open(function (err, datastore) {
                self._table = datastore.getTable(self._tableName);
                callback(err, self._table);
            });
        } else {
            this._timeout(callback.bind(this, null, this._table));
        } 
    },
    insert: function (record, callback) {
        this.getTable(function (err, table) {
            var result = table.insert(record);
            callback(undefined, this.recordToHash(result));
        }.bind(this));
    },
    /**
    * update a record
    * @param {object} record
    * @param {Function} callback
    */
    update: function (record, callback) {
        //console.log(record);
        var self = this;
        this.getTable(function (err, table) {
            var _record = table.get(record.id);
            if (_record) {
                _record.update(record);
                callback(err, self.recordToHash(_record));
            } else {
                callback(new Error(['Record with id ', record.id, ' not found'].join('')));
            }
        });
    },
    /**
    * get record by id
    * @param {String} id
    * @param {Function} callback
    */
    get: function (id, callback) {
        var self = this;
        this.getTable(function (err, table) {
            var record = table.get(id);
            callback(err, self.recordToHash(record));
        });
    },
    delete: function (record, callback) {
        if (record !== undefined && record.id !== undefined) {
            this.getTable(function (err, table) {
                var r = table.get(record.id);
                if (r) {
                    r.deleteRecord();
                    callback(err, record);
                }
            });
        } else {
            callback(undefined, null);
        }
    },
    findAll: function (query, callback) {
        var self = this;
        if (query instanceof Function) {
            callback = query;
            query = {};
        }
        this.getTable(function (err, table) {
            var records = table.query(query);
            callback(err, records.map(function (record) {
                return self.recordToHash(record);
            }));
        });
    },
    find: function (query, callback) {
        this.findAll(query, function (err, records) {
            var result;
            if (records) {
                result = records[0];
            }
            callback(err, result);
        });
    }
};

/**
 * @constructor
 */
fluxreader.File = function (client,Promisifier) {
    var writeFile,readFile,removeFile;
    writeFile=Promisifier.promisify(client.writeFile,client);
    readFile=Promisifier.promisify(client.readFile,client);
    removeFile =Promisifier.promisify(client.remove,client);
    /** writes a file */
    this.write=function(path,content){
        return writeFile(path,content);
    };
    /** read a file */
    this.read=function(path){
        return readFile(path);
    };
    /** remove a file */
    this.remove=function(path){
        return removeFile(path);
    };
};

/**
 * @constructor
 * @param {Dropbox.Client} dropboxClient
 * @param {Function} $timeout
 */
fluxreader.Database = function (dropboxClient, $timeout) {
    var datastore;
    /**
    * open default datastore
    * @param  {Function} callback
    * @return {void}
    */
    this.open = function (callback) {
        if (datastore === undefined) {
            var datastoreManager = dropboxClient.getDatastoreManager();
            datastoreManager.openDefaultDatastore(function (err, _datastore) {
                datastore = _datastore;
                callback(err, datastore);
            });
        } else {
            $timeout(callback.bind(null, null, datastore));
        }
    };
};

/**
 * @constructor
 * @param {fluxreader.Database} database
 * @param {Promise} $q
 * @param {Function} $timeout
 * @param {fluxreader.Table} Table
 */
fluxreader.TableFactory=function (database, $q, $timeout,Table) {
    this.Table = Table;
    /**
    * create a new table object
    * @param tableName
    * @return {Table}
    */
    this.create = function (tableName) {
        return new this.Table(tableName, database, $timeout);
    };
};

/**
 * Entry repository
 * @constructor
 * @param {fluxreader.TableFactory} tableFactory
 * @param {Function} md5
 * @param {fluxreader.File} File
 */
fluxreader.Entry=function (tableFactory,md5,File) {
    /**
    * Manage entry persistance
    */
    var entryTable,feedTable;
    /**
    * @type {database.Table}
    */
    entryTable = tableFactory.create('entry');
    this.getTable = function () {
        return entryTable;
    };
    this.setTable = function (value) {
        entryTable = value;
        return this;
    };
    this.getById = function (id, callback) {
        entryTable.get(id, function(err,entry){
            if(err){
                return callback(err);
            }
            if(!entry){
                return callback(new Error('Entry not found'));
            }
            File.read(entry.path).then(function(content){
                entry.content = content;
                callback(null,entry);
            }).catch(function(err){
                callback(err);
            });
        });
    };
    this.getCorrectDate = function (date) {
        var potentialDate = (new Date(date)).getTime();
        if (isNaN(potentialDate) || potentialDate === null) {
            potentialDate = (new Date()).getTime();
        }
        return potentialDate;
    };
    this.extractMediaGroups = function (entry) {
        //console.log('mediaGroups',entry);
        if (entry.mediaGroups instanceof Array) {
            return entry.mediaGroups.map(function (group) {
                if (group.contents instanceof Array) {
                    return group.contents.map(function (content) {
                        return content.url;
                    });
                }
            }).reduce(function (result, next) {
                result.push.apply(result, next);
                return result;
            }, []);
        }
        return [];
    };
    this.normalize = function (entry) {
        var normalized= {
            //mediaGroup: typeof(entry.mediaGroup) !== 'string' ? entry.mediaGroup !== undefined ? JSON.stringify(entry.mediaGroup) : "{}" : entry.mediaGroup,
            title: entry.title || "",
            link: entry.link || "",
            path:entry.path||"",
            contentSnippet: entry.contentSnippet || "",
            publishedDate: this.getCorrectDate(entry.publishedDate),
            categories: entry.categories || [],
            medias: entry.medias || this.extractMediaGroups(entry) ,
            createdAt: entry.createdAt||Date.now(),
            updatedAt:Date.now(),
            feedId: entry.feedId || "",
            favorite: !!entry.favorite,
            read: !!entry.read,
            deleted: !!entry.deleted,
            compressed: !!entry.compressed
        };
        if(entry.id){
            normalized.id=entry.id;
        }
        return normalized;
    };
    this.delete = function (entry, callback) {
        return entryTable.delete(entry, function(err,res){
            if(err){
                return callback(err);
            }
            return File.remove(entry.path).then(function(){
                //console.log('remove');
                return callback(null,res);
            }).catch(function(err){
                return callback(err);
            });
        });
    };
    /**
    * @param {Object} query
    * @param {Function} callback
    */
    this.findAll = function () {
        entryTable.findAll.apply(entryTable, [].slice.call(arguments));
    };
    /**
    * insert a new entry
    * if link already found in Entry table,no insert is necessary
    * entries are unique.
    * @param entry
    * @param callback
    */
    this.insert = function (entry, callback) {
        var self = this;
        //check if entry exists
        entryTable.find({link: entry.link, feedId: entry.feedId}, function (err, entryRecord) {
            if (err) {
                callback(err);
            } else if (entryRecord) {
                //entry exists
                callback(err, entryRecord);
            } else {
                /** set file name related to the entry */
                entry.path = md5(entry.link).concat('.html');
                File.write(entry.path,entry.content).then(function(){
                    var normalized=self.normalize(entry);
                    return entryTable.insert(normalized, callback);
                }).catch(function(err){
                    callback(err);
                });
            }
        });
    };
    this.update = function (entry, callback) {
        var _entry = _.clone(entry);
        delete _entry.feed;
        entryTable.update(this.normalize(_entry), callback);
    };
    /* favorite on unfavorite an entry */
    this.toggleFavorite = function (entry, callback) {
        entry.favorite = !entry.favorite;
        this.update(entry, callback);
    };
    /* mark an entry as read */
    this.markAsRead = function (entry, callback) {
        entry.read = true;
        this.getTable().update(entry, callback);
    };
    this.findFavorites=function(callback){
        return this.findAll({favorite:true},callback);
    };
    this.findUnread=function  (callback) {
        return this.findAll({read:false},callback);
    };
};

/**
 * Feed repository
 * @constructor
 */
fluxreader.Feed=function (tableFactory, Entry,feedFinder,$q, $timeout,opml,Import) {
    /**
    * Manage feed persistance
    */
    var feedTable = tableFactory.create('feed');

    return {
        /** interval in milliseconds between 2 opertations in a long running process */
        _batchInterval:1000,
        _refreshInterval:1000*60*60*24,
        setRefreshInterval:function(value){
            this._refreshInterval=value;
        },
        setBatchInterval:function  (milliseconds) {
            this._batchInterval=milliseconds;
        },
        /**
        * remove feed and remove any associated entry
        * @param feed
        * @param {Function} callback
        */
        delete : function (feed, callback) {
            feedTable.delete(feed, function (err, feed) {
                if (feed && feed.id) {
                    Entry.findAll({feedId: feed.id}, function (err, entries) {
                        async.forEach(entries, function (entry, next) {
                            Entry.delete(entry, next);
                        }, callback);
                    });
                }
            });
        },
        /**
        * get one feed by id
        * @param id
        * @param callback
        */
        getById : function (id, callback) {
            feedTable.get(id, callback);
        },
        findAll : function (query, callback) {
            feedTable.findAll(query, callback);
        },
        /**
        * should the feed be refreshed
        * @param {Feed} feed
        * @return {Boolean}
        */
        shouldRefresh:function(feed){
            return Date.now() > (feed.refreshedAt+this._refreshInterval);
        },
        /**
        * insert a new feed,feeds are unique
        * @param feed
        * @param callback
        */
        insert : function (feed, callback) {
            var self,entries;
            self=this;
            entries = feed.entries;
            delete feed.entries;
            feedTable.find({feedUrl: feed.feedUrl}, function (err, feedRecord) {
                if (err) {
                    console.warn('err', err);
                    callback(err);
                } else if (feedRecord) {
                    // feed exists,dont insert
                    if(!self.shouldRefresh(feedRecord)){
                        //dont refresh exit
                        return callback(null,feedRecord);
                    }
                    async.each(entries, function (entry, next) {
                        //dont insert feeds that dont have an entry
                        if (entry && entry.link) {
                            entry.feedId = feedRecord.id;
                            Entry.insert(entry, next);
                        } else {
                            next();
                        }
                    }, function (err) {
                        if(err){
                            return callback(err);
                        }
                        feedRecord.refreshedAt=Date.now();
                        feedTable.update(feedRecord,callback);
                    });
                } else {
                    //insert since doesnt exist
                    feed.createdAt = Date.now();
                    feed.refreshedAt= Date.now();
                    feedTable.insert(feed, function (err, feedRecord) {
                        async.eachSeries(entries, function (entry, next) {
                            if (entry && entry.link) {
                                entry.feedId = feedRecord.id;
                                Entry.insert(entry, next);
                            } else {
                                next();
                            }
                        }, function (err) {
                            return callback(err, feedRecord);
                        });
                    });
                }
            });
        },
        update : function(feed,callback){
            feed.updatedAt=Date.now();
            feedTable.update(feed,callback);
        },
        subscribe : function (url, callback) {
            var self = this;
            if (url) {
                return feedFinder.open(function () {
                    return feedFinder.findFeedByUrl(url, function (err, feed) {
                        if (feed) {
                            self.insert(feed, callback);
                        } else {
                            return callback(new Error(['Feed not found at ', url].join('')));
                        }
                    });
                });
            } 
            return $timeout(callback.bind(null, new Error('no url provided')), 1);
        },
        /**
        * import from file
        * @param {window.File} file
        * @param {Function} callback
        * @return {Promise}
        */
        import:function(file){
            var self=this;
            Import.isInProgress=true;
            return opml.import(file).then(function(feedUrlList){
                var deferred=$q.defer();
                async.eachSeries(feedUrlList,function(feedUrl,next){
                    deferred.notify({event:Import.events.IMPORT_FEED_START,value:feedUrl});
                    $timeout(self.subscribe.bind(self,feedUrl,function(err,feed){
                        if(err){
                            console.warn(err);
                            deferred.notify({event:Import.events.IMPORT_FEED_ERROR,value:err});
                        }else{
                            deferred.notify({event:Import.events.IMPORT_FEED_SUCCESS,value:feed});
                        }
                        next();
                    }),self._batchInterval);
                },function(err,res){
                    Import.isInProgress=false;
                    if(err){
                        return deferred.reject(err);
                    }
                    return deferred.resolve(res);
                });
                return deferred.promise;
            });
        },
        /**
        * export to xml string
        * @param {Function} callback
        * @return {void}
        */
        export:function(callback){
            this.findAll(function(err,feeds){
                if(err){
                    return callback(err);
                }
                return callback(null,opml.export(feeds));
            });
        }
    };
};
fluxreader.FeedProxy= function (Feed,Promisifier, $timeout, $q) {
    /* simple way to keep feeds in memory */
    var self = this;
    this.getById = function (id) {
        return this.load().then(function (feeds) {
            return $timeout(function () {
                return feeds.filter(function (feed) {
                    return id === feed.id;
                })[0];
            });
        });
    };
    this.load = function (forceReload) {
        var deferred = $q.defer();
        if (this.feeds && !forceReload) {
            return $q.when(this.feeds);
        } 
        Feed.findAll(function (err, feeds) {
            self.feeds = feeds || [];
            deferred.resolve(feeds);
        });
        return deferred.promise;
    };
    this.subscribe = function (url) {
        var deferred = $q.defer();
        Feed.subscribe(url, function (err, res) {
            if (err) {
                return deferred.reject(err);
            }
            deferred.resolve(res);
        });
        return deferred.promise;
    };
    /** insert a new feed */
    this.insert=_.compose(function  (promise) {
        return promise.then(this.load.bind(this,true));
    },Promisifier.promisify(Feed,'insert'));
    /** update a feed */
    this.update=_.compose(function(promise){
        return promise.then(this.load.bind(this,true));
    },Promisifier.promisify(Feed,'update'));
    /** delete a feed */
    this.delete=_.compose(function(promise){
        return promise.then(this.load.bind(this,true));
    },Promisifier.promisify(Feed,'delete'),function(feed){
        return this.feeds.splice(_.findIndex(this.feeds,{id:feed.id}),1)[0];
    });
    this.findAll=function(query){
        return this.load().then(function(feeds){
            return _.filter(feeds,query);
        });
    };
    this.import= Feed.import.bind(Feed);
    this.export= Promisifier.promisify(Feed,'export');
};

fluxreader.FolderRepository=function(Promisifier,tableFactory,Folder,$q){
    var folderTable = tableFactory.create('folder');

    ['find','delete','findAll','get',"update"].forEach(function(method){
        this[method]= Promisifier.promisify(folderTable,method);
    },this);
    this.normalize=function(folder){
        return {
            id:folder.id||null,
            title:folder.title,
            open:!!folder.open
        };
    };
    this.insert=function(folder){
        return this.find({title:folder.title})
        .then(function(_folder){
            if(_folder){
                return _folder;
            }
            var deferred = $q.defer();
            folderTable.insert(folder,function(err,folder){
                if(err){
                    return deferred.reject(err);
                }
                return deferred.resolve(folder);
            });
            return deferred.promise;
        });
    };
    this.update=_.compose(this.update,this.normalize);
};

fluxreader.Folder={
    isOpen:function(folder){
        return !!folder.open;
    },
    validate:function(folder){
        if(!/\w{1,100}/.test(folder.title)){
            return new Error('folder.title "'+folder.title+'" should be between 1 and 100 characters');
        }
    }
};
/**
 * Proxy to repository
 * only reload folders when dirty
 */
fluxreader.FolderProxy=function($q,FolderRepository){
    var self=this;
    this.dirty=true;
    this.query={};
    this.folders=[];
    this._load=function(force){
        var self=this;
        if(this.dirty || force){
            return FolderRepository.findAll(this.query)
            .then(function(folders){
                self.folders=folders;
                self.dirty=false;
                return folders;
            });
        }
        return $q.when(this.folders);
    };
    this.insert=function(folder){
        var f;
        return FolderRepository.insert(folder).then(function(folder){
            f=folder;
            return self._load(true);
        })
        .then(function(){
            return f;
        });
    };
    this.findAll=function(query){
        if(query){
            this.query=query;
        }
        return this._load();
    };
    this.find=function(query){
        return this._load()
        .then(function(folders){
            return _.filter(folders,query)[0];
        });
    };
    this.update=function(folder){
        var f;
        return FolderRepository.update(folder)
        .then(function(folder){
            return self._load(true);
        })
        .then(function(){
            return f;
        });
    };
    this.delete=function(folder){
        var f;
        this.folders.splice(_.findIndex(this.folders,{id:folder.id}),1);
        return FolderRepository.delete(folder)
        .then(function(folder){
            f=folder;
            return self._load(true);
        })
        .then(function(){
            return f;
        });
    };
};
fluxreader.FeedFinder=function($timeout){
    var _numEntries = 30, _google=google, initialized = false;
    /** set max entry number when fetching feed entries*/
    this.setNumEntries= function (number) {
        _numEntries = number;
    };
    /* set google object */
    this.setGoogle=function (google) {
        _google = google;
        return this;
    };
    /* load a feed according to its syndication url */
    this.findFeedByUrl= function (feedUrl, callback) {
        var self=this,feed = new _google.feeds.Feed(feedUrl);
        feed.includeHistoricalEntries();
        feed.setNumEntries(_numEntries);
        return feed.load(function (result) {
            if(!result.error){
                return callback(result.error, result.feed);
            }
            /*try a search strategy if no feed*/
            return _google.feeds.findFeeds("site:".concat(feedUrl),function(result){
                if(!result.error && result.entries.length>0){
                    console.log(result.entries);
                    return self.findFeedByUrl(result.entries[0].url,callback);
                }
                callback(result.error);
            });
        });
    };
    /* create a feed loader if undefined */
    this.open= function (callback) {
        if (!initialized) {
            _google.load('feeds', '1', {
                callback: callback
            });
        } else {
            $timeout(callback, 1);
        }

    };
};

/**
 * user repository
 * @todo
 */
fluxreader.User = function(){};

/**
 * feed import states
 */
fluxreader.Import=function(){
    this.isInProgress=false;
    this.events={
        IMPORT_FEED_START:"Import.IMPORT_FEED_START",
        IMPORT_FEED_SUCCESS:"Import.IMPORT_FEED_SUCCESS",
        IMPORT_FEED_ERROR:"Import.IMPORT_FEED_ERROR"
    };
};

fluxreader.Client = function(apiKey){
    return new Dropbox.Client({
        key: apiKey
    });
};

fluxreader.DropboxClient = function ($timeout,client) {
    return {
        authenticate:function(callback){
            callback=callback||function(){};
            client.authenticate({
                interactive: false
            },callback);
        },
        /* sign in */
        signIn: function () {
            client.authenticate();
        },
        /* sign out */
        signOut: function (callback) {
            client.signOut(callback);
        },
        isAuthenticated: function () {
            return client.isAuthenticated();
        },
        getDatastoreManager: function () {
            return client.getDatastoreManager();
        },
        /* get account info */
        getAccountInfo: function (callback) {
            client.getAccountInfo({
                httpProxy: true
            }, callback);
            /* @link https://www.dropbox.com/developers/datastore/docs/js#Dropbox.Client.getAccountInfo */

        }
    };
};

fluxreader.Promisifier = function($q){
    /**
    * takes a function that requires a callback(err,res) as last argument
    * and returns a function that returns a promise
    * @exemple
    *   promisify(Resource.fetch,Resource);
    *   promisify(Resource,"fetch");
    * @param {Function|Object} func  function or context
    * @param {Object|string} context context or function name
    * @param {*} arguments
    */
    this.promisify=function(func,context){
        if(typeof context ==='string'){
            var c=func;
            func = c[context];
            context = c;
        }
        return function(){
            var callback,deferred;
            deferred = $q.defer();
            callback= function(err,result){
                if(err){
                    deferred.reject(err);
                }else{
                    deferred.resolve(result);
                }
            };
            func.apply(context,[].slice.call(arguments).concat([callback]));
            return deferred.promise;
        };
    };
};
