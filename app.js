/**
 * This is an example of a basic node.js script that performs
 * the Authorization Code oAuth2 flow to authenticate against
 * the Spotify Accounts.
 *
 * For more information, read
 * https://developer.spotify.com/web-api/authorization-guide/#authorization_code_flow
 */

var express = require('express'); // Express web server framework
var request = require('request'); // "Request" library
var cors = require('cors');
var querystring = require('querystring');
var cookieParser = require('cookie-parser');
const axios = require("axios");

var client_id = 'cd891f5f3f9841309bc7513006129e4d'; // Your client id
var client_secret = '1b3b1e08708047bfac43d895d8f1b8ce'; // Your secret
var redirect_uri = 'http://localhost:8888/callback'; // Your redirect uri

/**
 * Generates a random string containing numbers and letters
 * @param  {number} length The length of the string
 * @return {string} The generated string
 */
var generateRandomString = function(length) {
  var text = '';
  var possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

  for (var i = 0; i < length; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
};

var stateKey = 'spotify_auth_state';

var app = express();

app.use(express.static(__dirname + '/public'))
   .use(cors())
   .use(cookieParser());

app.get('/login', function(req, res) {

  var state = generateRandomString(16);
  res.cookie(stateKey, state);

  // your application requests authorization
  var scope = 'user-read-private user-read-email user-library-read playlist-modify-private playlist-modify-public playlist-read-private';
  res.redirect('https://accounts.spotify.com/authorize?' +
    querystring.stringify({
      response_type: 'code',
      client_id: client_id,
      scope: scope,
      redirect_uri: redirect_uri,
      state: state
    }));
});

app.get('/callback', function(req, res) {

  // your application requests refresh and access tokens
  // after checking the state parameter

  var code = req.query.code || null;
  var state = req.query.state || null;
  var storedState = req.cookies ? req.cookies[stateKey] : null;

  if (state === null || state !== storedState) {
    res.redirect('/#' +
      querystring.stringify({
        error: 'state_mismatch'
      }));
  } else {
    res.clearCookie(stateKey);
    var authOptions = {
      url: 'https://accounts.spotify.com/api/token',
      form: {
        code: code,
        redirect_uri: redirect_uri,
        grant_type: 'authorization_code'
      },
      headers: {
        'Authorization': 'Basic ' + (new Buffer(client_id + ':' + client_secret).toString('base64'))
      },
      json: true
    };

    request.post(authOptions, function(error, response, body) {
      if (!error && response.statusCode === 200) {

        var access_token = body.access_token,
            refresh_token = body.refresh_token;

        var options = {
          url: 'https://api.spotify.com/v1/me',
          headers: { 'Authorization': 'Bearer ' + access_token },
          json: true
        };

        // use the access token to access the Spotify Web API
        request.get(options, function(error, response, body) {
          //console.log(body);
        });

        // we can also pass the token to the browser to make requests from there
        res.redirect('/#' +
          querystring.stringify({
            access_token: access_token,
            refresh_token: refresh_token
          }));
      } else {
        res.redirect('/#' +
          querystring.stringify({
            error: 'invalid_token'
          }));
      }
    });
  }
});

app.get('/refresh_token', function(req, res) {

  // requesting access token from refresh token
  var refresh_token = req.query.refresh_token;
  var authOptions = {
    url: 'https://accounts.spotify.com/api/token',
    headers: { 'Authorization': 'Basic ' + (new Buffer(client_id + ':' + client_secret).toString('base64')) },
    form: {
      grant_type: 'refresh_token',
      refresh_token: refresh_token
    },
    json: true
  };

  request.post(authOptions, function(error, response, body) {
    if (!error && response.statusCode === 200) {
      var access_token = body.access_token;
      res.send({
        'access_token': access_token
      });
    }
  });
});

app.get('/delete_songs_not_in_library_from_all_playlists', async function(req, res) {
  try{
    var access_token = req.query.access_token;
  
    let user_id = await getUserId(access_token);
  
    let playlistsByUser = await getListOfPlaylistsByUser(access_token, user_id);

    playlistsByUser = playlistsByUser.filter( plMetadata => plMetadata.name == "Inspire");

    for(let i = 0; i < playlistsByUser.length; i++) {
      let plMetadata = playlistsByUser[i];
      let listOfSongsInPlaylist = await compileListOfAllSongsInPlaylistWithSavedBoolean( access_token, plMetadata);
      let songsInPlaylistButNotSaved = listOfSongsInPlaylist.filter(track => track.saved == false);
      console.log(songsInPlaylistButNotSaved);
    }

    res.send("done!");
  }
  catch(err){
    console.log(err);
  }
});

console.log('Listening on 8888');
app.listen(8888);

async function getUserId(access_token){
    let config = {headers: { 'Authorization': 'Bearer ' + access_token }};
    let axiosResponse = await axios.get('https://api.spotify.com/v1/me', config);
    let user_id = axiosResponse.data.id;
    console.log("\n\nThe user's id is: ", user_id);
    return user_id;
}

async function getListOfPlaylistsByUser(access_token, user_id){
  let config = {headers: { 'Authorization': 'Bearer ' + access_token }, params: {limit: 50}};
  let axiosResponse = await axios.get(`https://api.spotify.com/v1/users/${user_id}/playlists`, config);
  let playlists = axiosResponse.data.items;
  let playlistsByUser = playlists.filter( pl => pl.owner.id == user_id); // remove lists user follow's but aren't his/hers
  playlistsByUser = playlistsByUser.map( pl => {return {id:pl.id, name:pl.name};});
  //console.log("\n\nThe playlists object: ", playlistsByUser);
  return playlistsByUser;
}

async function compileListOfAllSongsInPlaylistWithSavedBoolean(access_token, plMetadata){
      let plCompleteTrackList = [];
      let done = false;
      let myOffset = 0;

      while(!done)
      {

        let config = {
          headers: { 'Authorization': 'Bearer ' + access_token },
          params: {fields:"next, items.track.name, items.track.id, items.track.uri",
                    offset: myOffset,
                    limit: 50}
        };
        myOffset = myOffset + 50;
        let axiosResponse = await axios.get(`https://api.spotify.com/v1/playlists/${plMetadata.id}/tracks`, config);

        done = axiosResponse.data.next == null;

        let plPage = axiosResponse.data.items;
        let plTrackPage = plPage.map( item => {return {id: item.track.id, uri: item.track.uri, name: item.track.name};});
        await augmentTrackListWithWhetherSavedData(access_token, plTrackPage);
        plCompleteTrackList = plCompleteTrackList.concat(plTrackPage);
      }

      console.log(`Total number of tracks in playlist ${plMetadata.name} (${plMetadata.id}) is: `,
                  plCompleteTrackList.length);
      return plCompleteTrackList;
}

// trackList must be <= 50 songs
async function augmentTrackListWithWhetherSavedData(access_token, trackList){
  let justIds = trackList.map( obj => obj.id );

  let config = {
    headers: { 'Authorization': 'Bearer ' + access_token },
    params: {ids: justIds.join()}
  };
  let axiosResponse = await axios.get(`https://api.spotify.com/v1/me/tracks/contains`, config);
  let booleanList = axiosResponse.data;
  for(let j = 0; j < trackList.length; j++){
    trackList[j].saved = booleanList[j];
  }
}