import { useState, useCallback } from 'react';

export interface GeoLocation {
  latitude: number;
  longitude: number;
  accuracy?: number;
  address?: string;
  locality?: string;
  country?: string;
}

export interface GeolocationState {
  location: GeoLocation | null;
  error: string | null;
  loading: boolean;
}

async function reverseGeocode(latitude: number, longitude: number): Promise<Partial<GeoLocation>> {
  try {
    const params = new URLSearchParams({
      format: 'jsonv2',
      lat: String(latitude),
      lon: String(longitude),
      zoom: '18',
      addressdetails: '1',
      'accept-language': 'es',
    });
    const response = await fetch(`https://nominatim.openstreetmap.org/reverse?${params.toString()}`);
    if (!response.ok) return {};

    const data = await response.json();

    if (data.address) {
      const addr = data.address;
      const streetNumber = addr.house_number ? `${addr.house_number}` : '';
      const street = addr.road
        || addr.street
        || addr.pedestrian
        || addr.residential
        || addr.footway
        || addr.path
        || '';
      const locality = addr.city
        || addr.town
        || addr.village
        || addr.municipality
        || addr.city_district
        || addr.suburb
        || addr.neighbourhood
        || '';
      const namedPlace = data.name
        || addr.building
        || addr.amenity
        || addr.shop
        || addr.tourism
        || '';

      const addressParts = [];
      if (street) addressParts.push(street);
      if (streetNumber) addressParts.push(streetNumber);

      const address = addressParts.join(' ') || namedPlace;

      return {
        address: address || '',
        locality: locality || '',
        country: addr.country || '',
      };
    }
    return {};
  } catch (error) {
    console.error('Reverse geocoding error:', error);
    return {};
  }
}

export function useGeolocation() {
  const [state, setState] = useState<GeolocationState>({
    location: null,
    error: null,
    loading: false,
  });

  const getCurrentLocation = useCallback(async (): Promise<GeoLocation | null> => {
    setState({ location: null, error: null, loading: true });

    if (!navigator.geolocation) {
      const error = 'La geolocalización no está disponible en tu dispositivo';
      setState({ location: null, error, loading: false });
      return null;
    }

    return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        async (position) => {
          const latitude = position.coords.latitude;
          const longitude = position.coords.longitude;

          const geocoded = await reverseGeocode(latitude, longitude);

          const location: GeoLocation = {
            latitude,
            longitude,
            accuracy: position.coords.accuracy,
            address: geocoded.address,
            locality: geocoded.locality,
            country: geocoded.country,
          };
          setState({ location, error: null, loading: false });
          resolve(location);
        },
        (error) => {
          let errorMessage = 'Error al obtener tu ubicación';
          if (error.code === error.PERMISSION_DENIED) {
            errorMessage = 'Debes permitir el acceso a tu ubicación';
          } else if (error.code === error.POSITION_UNAVAILABLE) {
            errorMessage = 'Tu ubicación no está disponible';
          } else if (error.code === error.TIMEOUT) {
            errorMessage = 'La solicitud de ubicación tardó demasiado';
          }
          setState({ location: null, error: errorMessage, loading: false });
          resolve(null);
        },
        {
          enableHighAccuracy: true,
          timeout: 15000,
          maximumAge: 0,
        }
      );
    });
  }, []);

  return {
    ...state,
    getCurrentLocation,
  };
}
