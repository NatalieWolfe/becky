import { Socket } from 'socket.io-client';

import { Database } from './database.mjs';

enum ErrorCode {
  CONFLICT = 409,

  INTERNAL = 500,
  NOT_IMPLEMENTED = 501,
}

interface AddLocationRequest {
  requestId: string;
  name: string;
  lat: number;
  lon: number;
}

interface ListLocationsRequest {
  requestId: string;
}

interface WhereToGoRequest {
  requestId: string;
}

export class BeckyBot {
  private readonly _waitPromise: Promise<void>;
  private _waitResolve: () => void;
  private _waitReject: (err: Error) => void;

  constructor(
    private readonly _db: Database,
    private readonly _socket: Socket
  ) {
    this._waitPromise = new Promise<void>((resolve, reject) => {
      this._waitResolve = resolve;
      this._waitReject = reject;
    });

    this._socket.on('addLocation', this._addLocation.bind(this));
    this._socket.on('listLocations', this._listLocations.bind(this));
    this._socket.on('whereToGo', this._whereToGo.bind(this));
  }

  wait(): Promise<void> { return this._waitPromise; }

  async _addLocation(req: AddLocationRequest): Promise<void> {
    try {
      await this._db.insertLocation(req);
      this._socket.emit(req.requestId);
      return;
    } catch (err) {
      console.error('Failed to insert location:', req, err);
    }

    try {
      const loc = await this._db.getLocation(req.name);
      this._socket.emit(req.requestId, {
        error: ErrorCode.CONFLICT,
        location: loc
      })
      console.log('Location already existed.', loc);
    } catch (err) {
      console.log('Failed to fetch location by name:', req, err);
      this._socket.emit(req.requestId, { error: ErrorCode.INTERNAL });
    }
  }

  _listLocations(req: ListLocationsRequest) {
    this._socket.emit(req.requestId, {error: ErrorCode.NOT_IMPLEMENTED});
  }

  _whereToGo(req: WhereToGoRequest) {
    this._socket.emit(req.requestId, {error: ErrorCode.NOT_IMPLEMENTED});
  }
}
