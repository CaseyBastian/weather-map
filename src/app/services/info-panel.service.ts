import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

export enum InfoType {
  FORECAST = 'forecast',
  EVENT = 'event'
}

@Injectable({
  providedIn: 'root'
})
export class InfoPanelService {
  private infoPanelVisible = new BehaviorSubject<boolean>(false);
  private infoPanelType = new BehaviorSubject<InfoType | undefined>(undefined);
  private infoPanelData = new BehaviorSubject<any>(undefined);

  infoPanelVisible$ = this.infoPanelVisible.asObservable();
  infoPanelType$ = this.infoPanelType.asObservable();
  infoPanelData$ = this.infoPanelData.asObservable();

  constructor() { }

  toggleInfoPanel(){
    this.infoPanelVisible.next(!this.infoPanelVisible.value);
  }

  setInfoPanelVisibility(state: boolean) {
    this.infoPanelVisible.next(state);
  }

  setInfoPanelType(infoType: InfoType) {
    this.infoPanelType.next(infoType);
  }

  setInfoPanelData(infoData: any) {
    this.infoPanelData.next(infoData);
  }

  resetInfoPanel(){
    this.infoPanelVisible.next(false);
    this.infoPanelType.next(undefined);
    this.infoPanelData.next(undefined);
  }
}
