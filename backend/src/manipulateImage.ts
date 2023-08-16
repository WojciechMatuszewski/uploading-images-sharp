import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import sharp from "sharp";
import { Readable } from "stream";
import { encode } from "blurhash";

const s3Client = new S3Client({});

interface Input {
	key: string;
	bucket: string;
	operation: "blurHash" | "normalize";
}

export const handler = async ({ key, bucket, operation }: Input) => {
	const s3Response = await s3Client.send(
		new GetObjectCommand({
			Bucket: bucket,
			Key: key,
		})
	);

	if (!s3Response.Body) {
		return {};
	}

	if (operation === "normalize") {
		const imageStream = Readable.fromWeb(
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			s3Response.Body.transformToWebStream() as any
		);

		const newKey = key.replace(`original_`, `normalized_`);

		const transformer = sharp().resize({
			width: 640,
			height: 480,
			fit: sharp.fit.fill,
		});
		const upload = new Upload({
			client: s3Client,
			params: {
				Bucket: bucket,
				Key: newKey,
				Body: imageStream.pipe(transformer),
			},
		});
		await upload.done();

		return newKey;
	}

	const { data: pixels, info } = await sharp(
		await s3Response.Body.transformToByteArray()
	)
		.raw()
		.ensureAlpha()
		.resize({ width: 640, height: 480, fit: sharp.fit.inside })
		.toBuffer({ resolveWithObject: true });

	const encoded = encode(
		new Uint8ClampedArray(pixels),
		info.width,
		info.height,
		4,
		4
	);
	return encoded;
};
