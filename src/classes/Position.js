/** Represents a GPS position reading from the Geolocation API. */
export class Position {
  /**
   * @param {object} params
   * @param {number} params.lat       - Latitude in decimal degrees
   * @param {number} params.lng       - Longitude in decimal degrees
   * @param {number|null} params.heading  - Compass bearing in degrees from north, or null
   * @param {number} params.accuracy  - Accuracy radius in metres
   * @param {number|null} params.speed    - Ground speed in metres per second, or null
   */
  constructor({ lat, lng, heading = null, accuracy, speed = null }) {
    this.lat = lat;
    this.lng = lng;
    this.heading = heading;
    this.accuracy = accuracy;
    this.speed = speed;
  }
}
