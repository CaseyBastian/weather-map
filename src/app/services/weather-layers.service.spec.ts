import { TestBed } from '@angular/core/testing';

import { WeatherLayersService } from './weather-layers.service';

describe('WeatherLayersService', () => {
	let service: WeatherLayersService;

	beforeEach(() => {
		TestBed.configureTestingModule({});
		service = TestBed.inject(WeatherLayersService);
	});

	it('should be created', () => {
		expect(service).toBeTruthy();
	});
});
