import { Reader, Writer } from 'protobufjs/minimal';

type Message = Record<string, any>;

interface StaticCodec {
    create(value?: Message): Message;
    encode(value: Message): Writer;
    decode(value: Uint8Array | Reader): Message;
    toObject(value: Message, options?: unknown): Message;
}

function readerFor(value: Uint8Array | Reader): Reader {
    return value instanceof Reader ? value : Reader.create(value);
}

function nested(reader: Reader, decode: (reader: Reader, end: number) => Message): Message {
    return decode(reader, reader.uint32() + reader.pos);
}

function writeMessage(
    writer: Writer,
    field: number,
    value: Message | undefined,
    encode: (value: Message, writer: Writer) => void
): void {
    if (value === undefined || value === null) return;
    const child = writer.uint32(field << 3 | 2).fork();
    encode(value, child);
    child.ldelim();
}

function skip(reader: Reader, tag: number): void {
    reader.skipType(tag & 7);
}

function codec(
    encodeMessage: (value: Message, writer: Writer) => void,
    decodeMessage: (reader: Reader, end: number) => Message
): StaticCodec {
    return {
        create: value => value ?? {},
        encode(value) {
            // Writer.create() selects protobufjs' Node BufferWriter when nodejs_compat
            // is enabled. Workerd's Buffer.utf8Write implementation is not compatible
            // with BufferWriter's two-argument call, so always use the Uint8Array writer.
            const writer = new Writer();
            encodeMessage(value, writer);
            return writer;
        },
        decode(value) {
            const reader = readerFor(value);
            return decodeMessage(reader, reader.len);
        },
        toObject: value => value
    };
}

function encodeAndroid(value: Message, writer: Writer): void {
    if (value.androidVersion !== undefined) writer.uint32(18).string(value.androidVersion);
    if (value.apiVersion !== undefined) writer.uint32(24).int32(value.apiVersion);
    if (value.deviceName !== undefined) writer.uint32(34).string(value.deviceName);
    if (value.modelStr !== undefined) writer.uint32(42).string(value.modelStr);
    if (value.vendor !== undefined) writer.uint32(50).string(value.vendor);
}

function encodePlatform(value: Message, writer: Writer): void {
    writeMessage(writer, 1, value.android, encodeAndroid);
    writeMessage(writer, 4, value.desktopWindows, encodeDesktopWindows);
}

function encodeConnectivity(value: Message, writer: Writer): void {
    writeMessage(writer, 1, value.platformSpecificData, encodePlatform);
    if (value.deviceId !== undefined) writer.uint32(18).string(value.deviceId);
}

function encodeClientData(value: Message, writer: Writer): void {
    if (value.clientVersion !== undefined) writer.uint32(10).string(value.clientVersion);
    if (value.clientId !== undefined) writer.uint32(18).string(value.clientId);
    writeMessage(writer, 3, value.connectivitySdkData, encodeConnectivity);
}

function encodeChallengeAnswer(value: Message, writer: Writer): void {
    if (value.challengeType !== undefined) writer.uint32(8).int32(value.challengeType);
    writeMessage(writer, 4, value.hashCash, (answer, child) => {
        if (answer.suffix !== undefined) child.uint32(10).string(answer.suffix);
    });
}

function encodeChallengeAnswers(value: Message, writer: Writer): void {
    if (value.state !== undefined) writer.uint32(10).string(value.state);
    for (const answer of value.answers ?? []) writeMessage(writer, 2, answer, encodeChallengeAnswer);
}

function encodeClientTokenRequest(value: Message, writer: Writer): void {
    if (value.requestType !== undefined) writer.uint32(8).int32(value.requestType);
    writeMessage(writer, 2, value.clientData, encodeClientData);
    writeMessage(writer, 3, value.challengeAnswers, encodeChallengeAnswers);
}

function decodeHashCashParameters(reader: Reader, end: number): Message {
    const result: Message = {};
    while (reader.pos < end) {
        const tag = reader.uint32();
        if (tag >>> 3 === 1) result.length = reader.int32();
        else if (tag >>> 3 === 2) result.prefix = reader.string();
        else skip(reader, tag);
    }
    return result;
}

function decodeClientChallenge(reader: Reader, end: number): Message {
    const result: Message = {};
    while (reader.pos < end) {
        const tag = reader.uint32();
        if (tag >>> 3 === 1) result.type = reader.int32();
        else if (tag >>> 3 === 4) result.evaluateHashcashParameters = nested(reader, decodeHashCashParameters);
        else skip(reader, tag);
    }
    return result;
}

function decodeClientChallenges(reader: Reader, end: number): Message {
    const result: Message = { challenges: [] };
    while (reader.pos < end) {
        const tag = reader.uint32();
        if (tag >>> 3 === 1) result.state = reader.string();
        else if (tag >>> 3 === 2) result.challenges.push(nested(reader, decodeClientChallenge));
        else skip(reader, tag);
    }
    return result;
}

function decodeGrantedToken(reader: Reader, end: number): Message {
    const result: Message = {};
    while (reader.pos < end) {
        const tag = reader.uint32();
        if (tag >>> 3 === 1) result.token = reader.string();
        else if (tag >>> 3 === 2) result.expiresAfterSeconds = reader.int32();
        else if (tag >>> 3 === 3) result.refreshAfterSeconds = reader.int32();
        else skip(reader, tag);
    }
    return result;
}

function decodeClientTokenResponse(reader: Reader, end: number): Message {
    const result: Message = {};
    while (reader.pos < end) {
        const tag = reader.uint32();
        if (tag >>> 3 === 1) result.responseType = reader.int32();
        else if (tag >>> 3 === 2) result.grantedToken = nested(reader, decodeGrantedToken);
        else if (tag >>> 3 === 3) result.challenges = nested(reader, decodeClientChallenges);
        else skip(reader, tag);
    }
    return result;
}

function encodeClientTokenResponse(value: Message, writer: Writer): void {
    if (value.responseType !== undefined) writer.uint32(8).int32(value.responseType);
    writeMessage(writer, 2, value.grantedToken, (token, child) => {
        if (token.token !== undefined) child.uint32(10).string(token.token);
        if (token.expiresAfterSeconds !== undefined) child.uint32(16).int32(token.expiresAfterSeconds);
        if (token.refreshAfterSeconds !== undefined) child.uint32(24).int32(token.refreshAfterSeconds);
    });
    writeMessage(writer, 3, value.challenges, (challenges, child) => {
        if (challenges.state !== undefined) child.uint32(10).string(challenges.state);
        for (const challenge of challenges.challenges ?? []) {
            writeMessage(child, 2, challenge, (item, itemWriter) => {
                if (item.type !== undefined) itemWriter.uint32(8).int32(item.type);
                writeMessage(itemWriter, 4, item.evaluateHashcashParameters, (parameters, parameterWriter) => {
                    if (parameters.length !== undefined) parameterWriter.uint32(8).int32(parameters.length);
                    if (parameters.prefix !== undefined) parameterWriter.uint32(18).string(parameters.prefix);
                });
            });
        }
    });
}

function encodeClientInfo(value: Message, writer: Writer): void {
    if (value.clientId !== undefined) writer.uint32(10).string(value.clientId);
    if (value.deviceId !== undefined) writer.uint32(18).string(value.deviceId);
}

function encodeDuration(value: Message, writer: Writer): void {
    if (value.seconds !== undefined) writer.uint32(8).int64(value.seconds);
    if (value.nanos !== undefined) writer.uint32(16).int32(value.nanos);
}

function encodeHashcashSolution(value: Message, writer: Writer): void {
    if (value.suffix !== undefined) writer.uint32(10).bytes(value.suffix);
    writeMessage(writer, 2, value.duration, encodeDuration);
}

function encodeChallengeSolutions(value: Message, writer: Writer): void {
    for (const solution of value.solutions ?? []) {
        writeMessage(writer, 1, solution, (item, child) => {
            writeMessage(child, 1, item.hashcash, encodeHashcashSolution);
        });
    }
}

function encodeLoginRequest(value: Message, writer: Writer): void {
    writeMessage(writer, 1, value.clientInfo, encodeClientInfo);
    if (value.loginContext !== undefined) writer.uint32(18).bytes(value.loginContext);
    writeMessage(writer, 3, value.challengeSolutions, encodeChallengeSolutions);
    writeMessage(writer, 100, value.storedCredential, (credential, child) => {
        if (credential.username !== undefined) child.uint32(10).string(credential.username);
        if (credential.data !== undefined) child.uint32(18).bytes(credential.data);
    });
    writeMessage(writer, 101, value.password, (password, child) => {
        if (password.id !== undefined) child.uint32(10).string(password.id);
        if (password.password !== undefined) child.uint32(18).string(password.password);
    });
}

function decodeClientInfo(reader: Reader, end: number): Message {
    const result: Message = {};
    while (reader.pos < end) {
        const tag = reader.uint32();
        if (tag >>> 3 === 1) result.clientId = reader.string();
        else if (tag >>> 3 === 2) result.deviceId = reader.string();
        else skip(reader, tag);
    }
    return result;
}

function decodeStoredCredential(reader: Reader, end: number): Message {
    const result: Message = {};
    while (reader.pos < end) {
        const tag = reader.uint32();
        if (tag >>> 3 === 1) result.username = reader.string();
        else if (tag >>> 3 === 2) result.data = new Uint8Array(reader.bytes());
        else skip(reader, tag);
    }
    return result;
}

function decodePassword(reader: Reader, end: number): Message {
    const result: Message = {};
    while (reader.pos < end) {
        const tag = reader.uint32();
        if (tag >>> 3 === 1) result.id = reader.string();
        else if (tag >>> 3 === 2) result.password = reader.string();
        else skip(reader, tag);
    }
    return result;
}

function decodeLoginRequest(reader: Reader, end: number): Message {
    const result: Message = {};
    while (reader.pos < end) {
        const tag = reader.uint32();
        const field = tag >>> 3;
        if (field === 1) result.clientInfo = nested(reader, decodeClientInfo);
        else if (field === 2) result.loginContext = new Uint8Array(reader.bytes());
        else if (field === 100) result.storedCredential = nested(reader, decodeStoredCredential);
        else if (field === 101) result.password = nested(reader, decodePassword);
        else skip(reader, tag);
    }
    return result;
}

function encodeLoginOk(value: Message, writer: Writer): void {
    if (value.username !== undefined) writer.uint32(10).string(value.username);
    if (value.accessToken !== undefined) writer.uint32(18).string(value.accessToken);
    if (value.storedCredential !== undefined) writer.uint32(26).bytes(value.storedCredential);
    if (value.accessTokenExpiresIn !== undefined) writer.uint32(32).int32(value.accessTokenExpiresIn);
}

function encodeLoginResponse(value: Message, writer: Writer): void {
    writeMessage(writer, 1, value.ok, encodeLoginOk);
    if (value.error !== undefined) writer.uint32(16).int32(value.error);
    writeMessage(writer, 3, value.challenges, (challenges, child) => {
        for (const challenge of challenges.challenges ?? []) {
            writeMessage(child, 1, challenge, (item, itemWriter) => {
                writeMessage(itemWriter, 1, item.hashcash, (hashcash, hashcashWriter) => {
                    if (hashcash.prefix !== undefined) hashcashWriter.uint32(10).bytes(hashcash.prefix);
                    if (hashcash.length !== undefined) hashcashWriter.uint32(16).int32(hashcash.length);
                });
            });
        }
    });
    if (value.loginContext !== undefined) writer.uint32(42).bytes(value.loginContext);
}

function decodeLoginOk(reader: Reader, end: number): Message {
    const result: Message = {};
    while (reader.pos < end) {
        const tag = reader.uint32();
        if (tag >>> 3 === 1) result.username = reader.string();
        else if (tag >>> 3 === 2) result.accessToken = reader.string();
        else if (tag >>> 3 === 3) result.storedCredential = new Uint8Array(reader.bytes());
        else if (tag >>> 3 === 4) result.accessTokenExpiresIn = reader.int32();
        else skip(reader, tag);
    }
    return result;
}

function decodeHashcashChallenge(reader: Reader, end: number): Message {
    const result: Message = {};
    while (reader.pos < end) {
        const tag = reader.uint32();
        if (tag >>> 3 === 1) result.prefix = new Uint8Array(reader.bytes());
        else if (tag >>> 3 === 2) result.length = reader.int32();
        else skip(reader, tag);
    }
    return result;
}

function decodeLoginChallenge(reader: Reader, end: number): Message {
    const result: Message = {};
    while (reader.pos < end) {
        const tag = reader.uint32();
        if (tag >>> 3 === 1) result.hashcash = nested(reader, decodeHashcashChallenge);
        else if (tag >>> 3 === 2) {
            const length = reader.uint32();
            reader.pos += length;
            result.code = {};
        } else skip(reader, tag);
    }
    return result;
}

function decodeLoginChallenges(reader: Reader, end: number): Message {
    const result: Message = { challenges: [] };
    while (reader.pos < end) {
        const tag = reader.uint32();
        if (tag >>> 3 === 1) result.challenges.push(nested(reader, decodeLoginChallenge));
        else skip(reader, tag);
    }
    return result;
}

function decodeLoginResponse(reader: Reader, end: number): Message {
    const result: Message = {};
    while (reader.pos < end) {
        const tag = reader.uint32();
        const field = tag >>> 3;
        if (field === 1) result.ok = nested(reader, decodeLoginOk);
        else if (field === 2) result.error = reader.int32();
        else if (field === 3) result.challenges = nested(reader, decodeLoginChallenges);
        else if (field === 5) result.loginContext = new Uint8Array(reader.bytes());
        else skip(reader, tag);
    }
    return result;
}

export const ClientTokenRequest = codec(encodeClientTokenRequest, () => ({}));
export const ClientTokenResponse = codec(encodeClientTokenResponse, decodeClientTokenResponse);
export const LoginRequest = codec(encodeLoginRequest, decodeLoginRequest);
export const LoginResponse = codec(encodeLoginResponse, decodeLoginResponse);

function encodeDesktopWindows(value: Message, writer: Writer): void {
    if (value.osVersion !== undefined) writer.uint32(8).int32(value.osVersion);
    if (value.osBuild !== undefined) writer.uint32(24).int32(value.osBuild);
    if (value.platformId !== undefined) writer.uint32(32).int32(value.platformId);
    if (value.unknownValue5 !== undefined) writer.uint32(40).int32(value.unknownValue5);
    if (value.unknownValue6 !== undefined) writer.uint32(48).int32(value.unknownValue6);
    if (value.imageFileMachine !== undefined) writer.uint32(56).int32(value.imageFileMachine);
    if (value.peMachine !== undefined) writer.uint32(64).int32(value.peMachine);
    if (value.unknownValue10 !== undefined) writer.uint32(80).bool(value.unknownValue10);
}