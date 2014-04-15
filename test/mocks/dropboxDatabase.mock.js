/*jslint es5:true,node:true*/
/*global angular*/
(function() {
    "use strict";
    angular.module('dropboxDatabase.mock', [])
        .factory('database', function(dropboxClient, $timeout) {
            return {
                /**
                 * open default datastore
                 * @returns {$q.promise}
                 */
                open: function(callback) {
                    $timeout(callback, 1);
                },
                datastore: {
                    getTable: function(tableName) {
                        return {
                            tableName: tableName,
                            insert: function() {return;},
                            query: function() {
                                return [];
                            }
                        };
                    }
                }
            };
        });
}());