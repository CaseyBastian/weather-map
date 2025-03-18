import { Component } from '@angular/core';
import { WeatherDashboardComponent } from './weather-dashboard/weather-dashboard.component';

@Component({
	selector: 'app-root',
	standalone: true,
	templateUrl: './app.component.html',
	styleUrl: './app.component.scss',
	imports: [WeatherDashboardComponent],
})
export class AppComponent {
	title = 'weather-map';
}
