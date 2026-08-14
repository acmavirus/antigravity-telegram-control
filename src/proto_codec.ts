/**
 * Protobuf and Unified State Codec for Antigravity OAuth Tokens & State Sync
 * Decodes and Encodes OAuth tokens stored in Antigravity IDE SQLite state.vscdb
 */

export interface OAuthTokenDetails {
    accessToken: string;
    refreshToken: string;
    expiryTimestamp?: number;
    idToken?: string;
    email?: string;
    name?: string;
    projectId?: string;
}

export interface UnifiedTopicEntry {
    sentinelKey: string;
    payload: Uint8Array;
}

export class ProtoCodec {
    public static concatBytes(...arrays: Uint8Array[]): Uint8Array {
        const total = arrays.reduce((acc, curr) => acc + curr.length, 0);
        const result = new Uint8Array(total);
        let offset = 0;
        for (const arr of arrays) {
            result.set(arr, offset);
            offset += arr.length;
        }
        return result;
    }

    public static encodeVarint(val: number | bigint): Uint8Array {
        const bytes: number[] = [];
        let r = BigInt(val);
        while (r >= 128n) {
            bytes.push(Number((r & 127n) | 128n));
            r >>= 7n;
        }
        bytes.push(Number(r));
        return new Uint8Array(bytes);
    }

    public static readVarint(buffer: Uint8Array, offset: number): { value: bigint; nextOffset: number } {
        let value = 0n;
        let shift = 0n;
        let cur = offset;
        while (cur < buffer.length) {
            const byte = BigInt(buffer[cur]);
            value |= (byte & 127n) << shift;
            cur++;
            if ((byte & 128n) === 0n) {
                return { value, nextOffset: cur };
            }
            shift += 7n;
        }
        throw new Error("Incomplete varint data in protobuf buffer");
    }

    public static skipField(buffer: Uint8Array, offset: number, wireType: number): number {
        switch (wireType) {
            case 0:
                return this.readVarint(buffer, offset).nextOffset;
            case 1:
                return offset + 8;
            case 2: {
                const { value, nextOffset } = this.readVarint(buffer, offset);
                return nextOffset + Number(value);
            }
            case 5:
                return offset + 4;
            default:
                throw new Error(`Unknown wire type: ${wireType}`);
        }
    }

    public static encodeLenDelimField(fieldNum: number, data: Uint8Array): Uint8Array {
        const tag = (fieldNum << 3) | 2;
        const tagBytes = this.encodeVarint(tag);
        const lenBytes = this.encodeVarint(data.length);
        const result = new Uint8Array(tagBytes.length + lenBytes.length + data.length);
        result.set(tagBytes, 0);
        result.set(lenBytes, tagBytes.length);
        result.set(data, tagBytes.length + lenBytes.length);
        return result;
    }

    public static encodeStringField(fieldNum: number, value: string): Uint8Array {
        const encoded = new TextEncoder().encode(value);
        return this.encodeLenDelimField(fieldNum, encoded);
    }

    public static encodeVarintField(fieldNum: number, value: number | bigint): Uint8Array {
        const tag = (fieldNum << 3) | 0;
        const tagBytes = this.encodeVarint(tag);
        const valBytes = this.encodeVarint(value);
        return this.concatBytes(tagBytes, valBytes);
    }

    public static getField(buffer: Uint8Array, fieldNum: number): Uint8Array | null {
        let offset = 0;
        while (offset < buffer.length) {
            const { value: tag, nextOffset } = this.readVarint(buffer, offset);
            const wireType = Number(tag & 7n);
            const field = Number(tag >> 3n);
            if (field === fieldNum) {
                if (wireType === 2) {
                    const { value: length, nextOffset: dataOffset } = this.readVarint(buffer, nextOffset);
                    return buffer.slice(dataOffset, dataOffset + Number(length));
                }
                return null;
            }
            offset = this.skipField(buffer, nextOffset, wireType);
        }
        return null;
    }

    public static findVarintField(buffer: Uint8Array, fieldNum: number): number | null {
        let offset = 0;
        while (offset < buffer.length) {
            const { value: tag, nextOffset } = this.readVarint(buffer, offset);
            const wireType = Number(tag & 7n);
            const field = Number(tag >> 3n);
            if (field === fieldNum && wireType === 0) {
                const { value } = this.readVarint(buffer, nextOffset);
                return Number(value);
            }
            offset = this.skipField(buffer, nextOffset, wireType);
        }
        return null;
    }

    public static readString(buffer: Uint8Array): string {
        return new TextDecoder().decode(buffer);
    }

    public static isPersonalAccountEmail(email: string): boolean {
        const normalized = email.toLowerCase();
        return normalized.endsWith("@gmail.com") ||
            normalized.endsWith("@outlook.com") ||
            normalized.endsWith("@hotmail.com") ||
            normalized.endsWith("@qq.com") ||
            normalized.endsWith("@163.com");
    }

    /**
     * Creates protobuf encoded OAuth Info
     */
    public static createOAuthInfo(
        accessToken: string,
        refreshToken: string,
        expiryTimestamp: number,
        isGcpTos = false,
        idToken?: string,
        email?: string
    ): Uint8Array {
        let isGcp = isGcpTos;
        if (email && this.isPersonalAccountEmail(email)) {
            isGcp = false;
        }

        const field1 = this.encodeStringField(1, accessToken);
        const field2 = this.encodeStringField(2, "Bearer");
        const field3 = this.encodeStringField(3, refreshToken);

        // Field 4: Expiry timestamp sub-message (field 1: timestamp, field 2: 0)
        const expirySub = this.concatBytes(
            this.encodeVarintField(1, expiryTimestamp),
            this.encodeVarintField(2, 0)
        );
        const field4 = this.encodeLenDelimField(4, expirySub);

        const field5 = idToken ? this.encodeStringField(5, idToken) : new Uint8Array(0);
        const field6 = isGcp ? this.encodeVarintField(6, 1) : new Uint8Array(0);

        return this.concatBytes(field1, field2, field3, field4, field5, field6);
    }

    /**
     * Decodes OAuth details from an OAuthInfo protobuf buffer
     */
    public static extractOAuthTokenDetailsFromOAuthInfo(buffer: Uint8Array): OAuthTokenDetails | null {
        const field1 = this.getField(buffer, 1);
        const field3 = this.getField(buffer, 3);
        const field4 = this.getField(buffer, 4);
        const field5 = this.getField(buffer, 5);

        if (!field1 || !field3) {
            return null;
        }

        let expiry: number | undefined;
        if (field4) {
            const exp = this.findVarintField(field4, 1);
            if (exp !== null) {
                expiry = exp;
            }
        }

        return {
            accessToken: this.readString(field1),
            refreshToken: this.readString(field3),
            expiryTimestamp: expiry,
            idToken: field5 ? this.readString(field5) : undefined,
        };
    }

    public static decodeTopicDataEntry(buffer: Uint8Array): UnifiedTopicEntry {
        const keyData = this.getField(buffer, 1);
        if (!keyData) {
            throw new Error("Topic data entry key not found");
        }
        const rowData = this.getField(buffer, 2);
        if (!rowData) {
            throw new Error("Topic row not found");
        }
        const valData = this.getField(rowData, 1);
        if (!valData) {
            throw new Error("Topic row value not found");
        }
        return {
            sentinelKey: this.readString(keyData),
            payload: new Uint8Array(Buffer.from(this.readString(valData), "base64")),
        };
    }

    public static getUnifiedTopicEntryKey(buffer: Uint8Array): string | null {
        const keyData = this.getField(buffer, 1);
        return keyData ? this.readString(keyData) : null;
    }

    /**
     * Decodes Unified State entries from a buffer
     */
    public static decodeUnifiedStateTopicEntries(buffer: Uint8Array): UnifiedTopicEntry[] {
        const entries: UnifiedTopicEntry[] = [];
        let offset = 0;
        while (offset < buffer.length) {
            const startOffset = offset;
            const { value: tag, nextOffset } = this.readVarint(buffer, offset);
            const wireType = Number(tag & 7n);
            const field = Number(tag >> 3n);
            const nextFieldOffset = this.skipField(buffer, nextOffset, wireType);

            if (field === 1 && wireType === 2) {
                const { value: length, nextOffset: dataOffset } = this.readVarint(buffer, nextOffset);
                const subBuffer = buffer.slice(dataOffset, dataOffset + Number(length));
                try {
                    entries.push(this.decodeTopicDataEntry(subBuffer));
                } catch {
                    // skip malformed sub-entry
                }
            }
            offset = nextFieldOffset;
            if (offset <= startOffset) {
                break;
            }
        }
        return entries;
    }

    public static extractOAuthTokenInfoFromUnifiedPayload(payload: Uint8Array): OAuthTokenDetails | null {
        const direct = this.extractOAuthTokenDetailsFromOAuthInfo(payload);
        if (direct) {
            return direct;
        }
        const field1 = this.getField(payload, 1);
        if (!field1) {
            return null;
        }
        try {
            const base64Decoded = new Uint8Array(Buffer.from(this.readString(field1), "base64"));
            return this.extractOAuthTokenDetailsFromOAuthInfo(base64Decoded);
        } catch {
            return null;
        }
    }

    /**
     * Extracts OAuth Token from Unified State Sync binary
     */
    public static extractOAuthTokenInfoFromUnifiedState(buffer: Uint8Array): OAuthTokenDetails | null {
        try {
            const entries = this.decodeUnifiedStateTopicEntries(buffer);
            for (const entry of entries) {
                if (entry.sentinelKey === "oauthTokenInfoSentinelKey") {
                    const token = this.extractOAuthTokenInfoFromUnifiedPayload(entry.payload);
                    if (token) {
                        return token;
                    }
                }
            }
        } catch {
            // fallback
        }
        return null;
    }

    public static createUnifiedTopicEntry(sentinelKey: string, payload: Uint8Array): Uint8Array {
        const rowValue = this.encodeStringField(1, Buffer.from(payload).toString("base64"));
        const rowKey = this.encodeStringField(1, sentinelKey);
        const rowContent = this.concatBytes(rowKey, this.encodeLenDelimField(2, rowValue));
        return this.encodeLenDelimField(1, rowContent);
    }

    public static createUnifiedStateEntry(sentinelKey: string, payload: Uint8Array): string {
        const entry = this.createUnifiedTopicEntry(sentinelKey, payload);
        return Buffer.from(entry).toString("base64");
    }

    public static replaceUnifiedTopicEntry(buffer: Uint8Array, sentinelKey: string, payload: Uint8Array): Uint8Array {
        const filtered: Uint8Array[] = [];
        let offset = 0;
        while (offset < buffer.length) {
            const startOffset = offset;
            const { value: tag, nextOffset } = this.readVarint(buffer, offset);
            const wireType = Number(tag & 7n);
            const field = Number(tag >> 3n);
            const nextFieldOffset = this.skipField(buffer, nextOffset, wireType);

            let matchesKey = false;
            if (field === 1 && wireType === 2) {
                const { value: length, nextOffset: dataOffset } = this.readVarint(buffer, nextOffset);
                const subBuffer = buffer.slice(dataOffset, dataOffset + Number(length));
                matchesKey = this.getUnifiedTopicEntryKey(subBuffer) === sentinelKey;
            }

            if (!matchesKey) {
                filtered.push(buffer.slice(startOffset, nextFieldOffset));
            }
            offset = nextFieldOffset;
            if (offset <= startOffset) {
                break;
            }
        }

        const newEntry = this.createUnifiedTopicEntry(sentinelKey, payload);
        filtered.push(newEntry);
        return this.concatBytes(...filtered);
    }

    public static createMinimalUserStatusPayload(email: string): Uint8Array {
        return this.concatBytes(
            this.encodeStringField(3, email),
            this.encodeStringField(7, email)
        );
    }

    public static createStringValuePayload(str: string): Uint8Array {
        return this.encodeStringField(3, str);
    }
}
