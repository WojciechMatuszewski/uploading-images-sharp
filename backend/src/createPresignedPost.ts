import { S3Client } from "@aws-sdk/client-s3";
import { createPresignedPost } from "@aws-sdk/s3-presigned-post";
import { asyncResult, result } from "@expo/results";
import { APIGatewayProxyHandler } from "aws-lambda";
import { ulid } from "ulidx";

import { Output, literal, number, object, parse, union } from "valibot";

const s3Client = new S3Client({});
const fiveMinutesInSeconds = 300;

export const handler: APIGatewayProxyHandler = async (event) => {
	if (!event.body) {
		return {
			body: JSON.stringify({
				message: "Missing body",
			}),
			statusCode: 403,
		};
	}

	const parseBodyResult = parseBody(event.body);
	if (!parseBodyResult.ok) {
		return {
			statusCode: 403,
			body: JSON.stringify({
				message: "Invalid body",
			}),
			headers: {
				"Content-Type": "application/json",
				"Access-Control-Allow-Origin": "*",
				"Access-Control-Allow-Methods": "*",
			},
		};
	}

	const generateUrlResult = await asyncResult(
		generateUrl(parseBodyResult.value)
	);
	if (!generateUrlResult.ok) {
		return {
			statusCode: 500,
			body: JSON.stringify({
				message: "Failed to generate url",
			}),
			headers: {
				"Content-Type": "application/json",
				"Access-Control-Allow-Origin": "*",
				"Access-Control-Allow-Methods": "*",
			},
		};
	}

	const { fields, url, id } = generateUrlResult.value;
	return {
		body: JSON.stringify({
			url,
			id,
			fields,
		}),
		statusCode: 200,
		headers: {
			"Content-Type": "application/json",
			"Access-Control-Allow-Origin": "*",
			"Access-Control-Allow-Methods": "*",
		},
	};
};

const bodySchema = object({
	size: number(),
	contentType: union([
		literal("image/jpeg"),
		literal("image/png"),
		literal("image/webp"),
		literal("image/avif"),
	]),
});

type Body = Output<typeof bodySchema>;

function parseBody(body: string) {
	try {
		const parsedPayload = parse(bodySchema, JSON.parse(body));
		return result(parsedPayload);
	} catch (error) {
		return result(error as Error);
	}
}

async function generateUrl(body: Body) {
	const { size, contentType } = body;

	const extension = extensionsForContentType[contentType];
	if (!extension) {
		throw new Error("Invalid content type");
	}

	const id = ulid();
	const key = `original_${id}.${extension}`;
	const { url, fields } = await createPresignedPost(s3Client, {
		Bucket: process.env.IMAGES_BUCKET_NAME!,
		Key: key,
		Conditions: [["content-length-range", size, size]],
		Expires: fiveMinutesInSeconds,
	});

	return { url, fields, id };
}

const extensionsForContentType = {
	"image/avif": "avif",
	"image/jpeg": "jpeg",
	"image/png": "png",
	"image/webp": "webp",
};
