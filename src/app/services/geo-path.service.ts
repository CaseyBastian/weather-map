import { Injectable, Renderer2 } from '@angular/core';
import { Map as OLMap, Feature, Overlay } from 'ol';
import { fromLonLat } from 'ol/proj';

export interface GeoPathLocation {
	locationName: string;
	latitude: number;
	longitude: number;
}

const geoLocations: GeoPathLocation[] = [
	{
		locationName: 'San Francisco, California',
		longitude: -122.4194,
		latitude: 37.7749,
	},
	{
		locationName: 'Philadelphia, Pennsylvania',
		longitude: -75.1652,
		latitude: 39.9526,
	},
	{
		locationName: 'Berlin, Germany',
		longitude: 13.405,
		latitude: 52.52,
	},
	{
		locationName: 'Athens, Greece',
		longitude: 23.7275,
		latitude: 37.9838,
	},
	{
		locationName: 'Tokyo, Japan',
		longitude: 139.6917,
		latitude: 35.6895,
	},
	{
		locationName: 'Sydney, Australia',
		latitude: -33.8688,
		longitude: 151.2093,
	},
	{
		locationName: 'Mumbai, India',
		latitude: 19.076,
		longitude: 72.8777,
	},
];

@Injectable({
	providedIn: 'root',
})
export class GeoPathService {
	constructor() {}

	get locations(): GeoPathLocation[] {
		return geoLocations;
	}
}
