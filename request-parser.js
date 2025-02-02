// Super important constants
var RANDY = "+19143258424";
var BRIAN = "+13016414902";

var dialects = require('./dialects.json');
var format = require('string-format').extend(String.prototype);

var echojs = require('echojs');

var echo = echojs({
  key: process.env.ECHONEST_KEY
});

var requestLib = require('request');

// Can take either a string or an array of strings to compare against
String.prototype.contains = function(s) {
  if (typeof s === "string")
    return this.toLowerCase().indexOf(s.toLowerCase()) != -1;

  for (var i = 0; i < s.length; i++)
    if (this.contains(s[i]))
      return true;

  return false;
};

var testGenres = ["a cappella", "acoustic pop", "classic rock", "hip hop"];
var userMap = {};
var ADVENTUROUSNESS = 1;

var createTasteProfile = function(client, request) {
  var phone = request.From;
  console.log("Creating taste profile for " + phone);

  echo('tasteprofile/create').post({
    name: phone,
    type: 'song'
  }, function(err, json) {
    if (err) {
      console.log(err);
    } else {
      console.log("Json: " + JSON.stringify(json.response.status));
      userMap[phone].tasteProfileId = json.response.status.id;
      userMap[phone].dialect = "normal";
      console.log(JSON.stringify(userMap));
      console.log("Created a taste profile for " + phone);

      updateTasteProfile(phone, testGenres);
    }
  });
};

var updateTasteProfile = function(phone, genres) {
  echo('tasteprofile/update').post({
    id: userMap[phone].tasteProfileId,
    data: toTasteProfileJSON(genres)
  }, function(err, json) {
    if (err) {
      console.log(err);
    } else {
      console.log("Updated taste profile for " + phone);
    }
  })
};

var toTasteProfileJSON = function(genres) {
  var json = [];

  genres.forEach(function(genre) {
    json.push({ "action" : "update", "item" : { "item_id" : "interest-" + genre, "genre" : genre }});
  });

  return JSON.stringify(json);
};

// This is the entry point for all SMS requests
var parseRequest = function(client, request, firstTime) {
  if (firstTime) {
      sendWelcomeMessage(client, request);
      return;
  }

  var body = request.Body.trim();

  if (!userMap[request.From]) {
    userMap[request.From] = {};
    sendWelcomeMessage(client, request);
    createTasteProfile(client, request);
  }
  if (body.contains("who sings ") && request.From == RANDY)
    trollRandy(client, request);
  else if (body.contains("commands"))
    sendCommands(client, request);
  else if (body.contains("who sings "))
    getArtistBySongName(client, request);
  else if (body.contains(["recommend", "song me", "suggest", "give me a song"]))
    getRecommendation(client, request);
  // else if (body.contains("love") || body.contains("like"))
  //   sendSongLike(client, request);
  // else if (body.contains("hate") || body.contains("dislike"))
  //   sendSongDislike(client, request);
  else if (body.contains("speak"))
    setDialect(client, request);
  else if (body.contains("can't open"))
    setLinkStyle(client, request);
  else if (body.contains("thank"))
    sendYoureWelcome(client, request);
  // else
  //   echoText(client, request);
};

var sendWelcomeMessage = function(client, request) {
    userMap[request.From].usingAppLink = true;

    client.sendMessage({
        to: request.From,
        body: "Welcome to Uncharted!\n" +
              "We're sending your first recommendation now. " +
              "Send 'recommend' to get more!",
        from: process.env.TWILIO_NUMBER
    }, function(err, messageData) {
        if (err) {
            console.log(err);
        } else {
            console.log("Sent welcome");
            getRecommendation(client, request);
        }
    });
};

var setDialect = function(client, request) {
    var dialect = request.Body.replace("Speak ", "").trim();
    userMap[request.From].dialect = dialect;

    client.sendMessage({
        to: request.From,
        body: getPhrase(dialect,"switch"),
        from: process.env.TWILIO_NUMBER
    }, function(err, messageData) {
        if (err) {
            console.log(err);
        } else {
            console.log("Sent you're welcome");
        }
    });
};

var sendYoureWelcome = function(client, request) {
    client.sendMessage({
        to: request.From,
        body: getPhrase(userMap[request.From].dialect,"welcome"),
        from: process.env.TWILIO_NUMBER
    }, function(err, messageData) {
        if (err) {
            console.log(err);
        } else {
            console.log("Sent you're welcome");
        }
    });
};

// A proof-of-concept for connecting all of our APIs
var getArtistBySongName = function(client, request) {
    var songName = request.Body.replace("Who sings ", "").replace("?", "").trim();
    console.log(songName);

    // http://developer.echonest.com/docs/v4/song.html#search
    echo('song/search').get({
      title: songName,
      results: 1,
      sort: "artist_familiarity-desc"
    }, function (err, json) {
      var songs = json.response.songs;

      var artistName = songs ? songs[0].artist_name : "Nobody";

      client.sendMessage({
        to: request.From,
        body: getPhrase(userMap[request.From].dialect,"whoSings").format(artistName, songName),
        from: process.env.TWILIO_NUMBER
      }, function(err, messageData) {
        if (err) {
          console.log(err);
        } else {
          console.log("Song request sent! SID: " + messageData.sid);
        }
      });

      console.log(json.response);
    });
};

var getRecommendation = function(client, request) {
  var url = 'http://developer.echonest.com/api/v4/playlist/static?';

  requestLib({
    uri: url,
    method: 'GET',
    qs: {
      results: 5,
      type: 'genre-radio',
      genre: testGenres,
      bucket: ["id:spotify", "tracks"],
      api_key: process.env.ECHONEST_KEY
    },
    qsStringify: {
      indices: false
    },
    useQuerystring: true,
    headers: { 'Content-Type' : 'application/json' }
    // seed_catalog: userMap[request.From].tasteProfileId,
    // distriution: 'wandering',
    // adventurousness: ADVENTUROUSNESS
  }, function(err, response, body) {
    if (err) {
      console.log(err);
    } else {
      var json = JSON.parse(body);
      var song = json.response.songs[Math.floor(Math.random() * 4)];
      var songId = song.tracks[0].foreign_id.replace("spotify:track:", "");
      song.spotifyUrl = (userMap[request.From].usingAppLink ? 'spotify://' : 'http://open.spotify.com/') + 'track/' + songId;

      client.sendMessage({
        to: request.From,
        from: process.env.TWILIO_NUMBER,
        body: getPhrase(userMap[request.From].dialect,"haveYouHeardSong").format(song)
      }, function(err, messageData) {
        if (err) {
          console.log(err);
        } else {
          console.log("Recommendation sent! SID: " + messageData.sid);
        }
      });
    }
  });
};

// Echos what the user sent for testing purposes
var echoText = function(client, request) {
  client.sendMessage({
    to: request.From,
    body: "You said \"" + request.Body + "\"",
    from: process.env.TWILIO_NUMBER
  }, function(err, messageData) {
    if (err) {
      console.log(err);
    } else {
      console.log("Message sent! SID: " + messageData.sid);
    }
  });
};

// Sends list of commands with short descriptions to user
var sendCommands = function(client, request) {
  client.sendMessage({
    to: request.From,
    from: process.env.TWILIO_NUMBER,
    body: "'Who sings [song name]?'': tells you who sings a song\n" +
          "'Recommend': Recommends a song based on your profile\n" +
          "'I loved it': Let us know that you liked a recommendation.\n" +
          "'I hated it': Let us know that you disliked a recommendation.\n" +
          "'Speak [dialect]': Tell Uncharted how to talk to you.\n" +
          "'I can't open that link': Switch link style (for Android users)"
  }, function(err, messageData) {
    if (err) {
      console.log(err);
    } else {
      console.log("Help sent! SID: " + messageData.sid);
    }
  });
};

// TODO: read previous messages and resend link in the new format

// Toggles link style between normal web link and app link
var setLinkStyle = function(client, request) {
  userMap[request.From].usingAppLink = !userMap[request.From].usingAppLink;

  client.sendMessage({
    to: request.From,
    from: process.env.TWILIO_NUMBER,
    body: getPhrase(userMap[request.From].dialect, "switchLinkStyle")
  }, function(err, messageData) {
    if (err) {
      console.log(err);
    } else {
      console.log("Link style switched! SID: " + messageData.sid);
    }
  });
};

// For teh lolz
var trollRandy = function(client, request) {
  client.sendMessage({
    to: request.From,
    from: process.env.TWILIO_NUMBER,
    body: "Why don't you figure it out yourself?",
    mediaUrl: "http://stream1.gifsoup.com/view8/20150417/5198682/ha-got-em-o.gif"
  }, function(err, messageData) {
    if (err) {
      console.log(err);
    }
  });
};

var getPhrase = function(dialect,phrase) {
    var p = dialects[dialect][phrase];
    var randPhraseIdx = randInt(0,p.length);
    return p[randPhraseIdx];
};

function randInt(low, high) { return Math.floor(Math.random() * high) + low }

module.exports = parseRequest;
