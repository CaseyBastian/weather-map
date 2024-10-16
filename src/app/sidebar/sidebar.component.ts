import { Component, OnInit } from '@angular/core';
import { WeatherLayer, WeatherLayersService } from '../services/weather-layers.service';
import { Observable } from 'rxjs';
import { CommonModule} from '@angular/common';
import { MatIconModule } from '@angular/material/icon';

@Component({
  selector: 'app-sidebar',
  standalone: true,
  templateUrl: './sidebar.component.html',
  styleUrl: './sidebar.component.scss',
  imports: [CommonModule, MatIconModule]
})
export class SidebarComponent implements OnInit {
  layers$!: Observable<WeatherLayer[]>;
  sidebarVisible: boolean = true;

  constructor(private weatherLayerService: WeatherLayersService){}

  ngOnInit(): void {
    this.layers$ = this.weatherLayerService.layers$;
  }

  toggleLayerVisibility(layerName: string): void {
    this.weatherLayerService.toggleLayerVisibility(layerName);
  }

  toggleSidebar() {
    this.sidebarVisible = !this.sidebarVisible;
  }
}
