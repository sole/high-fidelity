'use strict';

define([
    'underscore',
    'backbone',
    'datastore',
    'queue',
    'collections/episodes',
    'require'
], function(_, Backbone, DataStore, queue, Episodes, require) {
    var EpisodeModel = Backbone.Model.extend({
        // Keep track of how many chunks of data we receive and how many
        // we've saved, so we know when we have all data.
        _chunkCount: 0,
        _chunkSaveCount: 0,

        collection: Episodes,
        defaults: {
            _chunkCount: 0,
            isDownloaded: false,
            playbackPosition: 0,
            url: null
        },

        initialize: function() {
            _(this).bindAll('_download', '_incrementChunkSaveCount',
                            '_onDownloadComplete');
        },

        // Access (or set) an app's blob data in indexedDB.
        blob: function(callback) {
            this._assembleChunkData(callback);
        },

        // Output the published date of this podcast in a pretty way.
        date: function() {
            var date = new Date(this.get('datePublished'));
            return date.toLocaleDateString();
        },

        // Extend Backbone's default destroy method so we also delete the
        // podcast blob in indexedDB.
        destroy: function(options) {
            DataStore.destroy('e{id}'.format({id: this.get('id')}));

            return Backbone.Model.prototype.destroy.call(this, options);
        },

        // TODO: Fire an event that says we've queued this download, so we
        // can display this information in the UI.
        // TODO: Hook the above into the UI.
        download: function() {
            this.trigger('download:queued');
            queue.add('e{id}'.format({id: this.get('id')}), this);
        },

        podcast: function() {
            var Podcasts = require('collections/podcasts');
            return Podcasts.where({id: this.get('podcastID')})[0];
        },

        // Download a podcast's audio file. Called by the download queue
        // manager, so we don't try to download one hundred MP3s at once!
        _download: function() {
            var self = this;

            this.trigger('download:started');

            var request = new window.XMLHttpRequest({mozSystem: true});

            request.open('GET', this.get('enclosure'), true);
            request.responseType = 'moz-chunked-arraybuffer';

            request.addEventListener('load', this._onDownloadComplete);

            request.addEventListener('progress', function(event) {
                self._saveChunk(self._chunkCount, request.response);

                // Increment our internal data chunk count.
                self._chunkCount++;
            });

            request.addEventListener('error', function(event) {
                window.alert('Error downloading this episode. Please try again.');

                self.trigger('download:cancel');
            });

            request.send(null);
        },

        _assembleChunkData: function(callback) {
            var audioBlobs = [];
            var chunkCount = this.get('_chunkCount');
            var self = this;
            var type = this.get('type');

            function _walkChunks(chunkID) {
                if (chunkID === undefined) {
                    chunkID = 0;
                }

                if (chunkID < chunkCount) {
                    DataStore.get('_chunk-episode-{id}-{chunk}'.format({
                        chunk: chunkID,
                        id: self.get('id')
                    }), function(data) {
                        audioBlobs.push(data.file);
                        _walkChunks(chunkID + 1);
                    });
                } else {
                    var blob = new window.Blob(audioBlobs, {type: type});
                    callback(blob);
                }
            }

            _walkChunks();
        },

        _incrementChunkSaveCount: function(callback) {
            this._chunkSaveCount++;

            if (this._chunkCount === this._chunkSaveCount && this.get('type')) {
                this.set({
                    _chunkCount: this._chunkCount,
                    isDownloaded: true
                });
                this.save();

                queue.done('e{id}'.format({id: this.get('id')}));

                this.trigger('downloaded');
                this.trigger('updated');
            }
        },

        _onDownloadComplete: function(event) {
            // TODO: Make this better.
            var type;

            try {
                type = event.target.response.type.split('/')[1];
            } catch (e) {
                type = this.get('enclosure').split('.')[this.get('enclosure').split('.').length - 1];
            }

            // Assume "mpeg" = MP3, for now. Kinda hacky.
            if (type === 'mpeg') {
                type = 'mp3';
            }

            this.set({type: type});
            this.save();
        },

        _saveChunk: function(chunk, arrayBuffer) {
            DataStore.set('_chunk-episode-{id}-{chunk}'.format({
                chunk: chunk,
                id: this.get('id')
            }), arrayBuffer, this._incrementChunkSaveCount);
        },

        _setBlob: function(blob) {
            var self = this;

            DataStore.set(this.id, blob, function() {
                self.set({
                    isDownloaded: true
                });
                self.save();
                self.trigger('downloaded');
                self.trigger('updated');
            });
        }
    });

    return EpisodeModel;
});
